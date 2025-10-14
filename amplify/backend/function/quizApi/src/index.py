import os
import json
import boto3
import random
import datetime
from urllib.parse import parse_qs


dynamodb = boto3.resource('dynamodb')
QUESTIONS_TABLE = (
    os.environ.get('STORAGE_QUIZQUESTIONS_NAME')
    or os.environ.get('QUESTIONS_TABLE')
    or 'QuizQuestions'
)
SUBJECTS_TABLE = (
    os.environ.get('STORAGE_QUIZSUBJECTS_NAME')
    or os.environ.get('SUBJECTS_TABLE')
    or 'QuizSubjects'
)
questions_table = dynamodb.Table(QUESTIONS_TABLE)
subjects_table = dynamodb.Table(SUBJECTS_TABLE)


ALLOWED_ORIGINS = set([
    'http://localhost:3000',
    'https://cybermcq.com',
    'https://www.cybermcq.com',
])


def _cors_headers(event):
    origin = (event.get('headers') or {}).get('origin') or (event.get('headers') or {}).get('Origin')
    allow_origin = origin if origin in ALLOWED_ORIGINS or (origin and origin.endswith('.amplifyapp.com')) else 'http://localhost:3000'
    return {
        'Access-Control-Allow-Origin': allow_origin,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    }


def _response(event, status, body=None, content_type='application/json'):
    return {
        'statusCode': status,
        'headers': {**_cors_headers(event), 'Content-Type': content_type},
        'body': json.dumps(body or {}),
    }


def _now_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


def _require_admin(event):
    # Amplify user pool authorizer injects claims in requestContext authorizer
    claims = (
        (event.get('requestContext') or {})
        .get('authorizer', {})
        .get('jwt', {})
        .get('claims', {})
    )
    groups = []
    if 'cognito:groups' in claims:
        raw = claims['cognito:groups']
        if isinstance(raw, str):
            groups = raw.split(',')
        elif isinstance(raw, list):
            groups = raw
    return 'Admin' in groups


def lambda_handler(event, context):
    method = event.get('httpMethod', 'GET')
    path = event.get('path', '/')

    if method == 'OPTIONS':
        return {'statusCode': 200, 'headers': _cors_headers(event), 'body': ''}

    qs = event.get('queryStringParameters') or {}
    body = event.get('body') or ''
    if event.get('isBase64Encoded') and body:
        import base64
        body = base64.b64decode(body).decode('utf-8')

    # Subjects
    if method == 'GET' and path.endswith('/subjects'):
        limit = int(qs.get('limit', '50'))
        eks = qs.get('nextToken')
        scan_kwargs = {'Limit': min(limit, 100)}
        if eks:
            scan_kwargs['ExclusiveStartKey'] = json.loads(eks)
        res = subjects_table.scan(**scan_kwargs)
        return _response(event, 200, {
            'items': res.get('Items', []),
            'nextToken': json.dumps(res['LastEvaluatedKey']) if 'LastEvaluatedKey' in res else None,
        })

    if path.endswith('/subjects') and method == 'POST':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        try:
            payload = json.loads(body or '{}')
            for f in ['subjectName']:
                if f not in payload or not str(payload[f]).strip():
                    return _response(event, 400, {'error': f'Missing field: {f}'})
            subject_name = str(payload['subjectName']).strip()
            # Enforce unique subjectName via GSI
            existing = subjects_table.query(
                IndexName='SubjectNameIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('subjectName').eq(subject_name),
                Limit=1,
            )
            if existing.get('Items'):
                return _response(event, 409, {'error': 'Subject name already exists'})

            subject_id = payload.get('subjectId') or _gen_id()
            now = _now_iso()
            item = {
                'subjectId': subject_id,
                'subjectName': subject_name,
                'description': str(payload.get('description') or ''),
                'createdAt': now,
                'updatedAt': now,
            }
            subjects_table.put_item(Item=item, ConditionExpression='attribute_not_exists(subjectId)')
            return _response(event, 201, item)
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    if '/subjects/' in path and method == 'GET':
        sid = path.rsplit('/', 1)[-1]
        res = subjects_table.get_item(Key={'subjectId': sid})
        item = res.get('Item')
        if not item:
            return _response(event, 404, {'error': 'Not found'})
        return _response(event, 200, item)

    if '/subjects/' in path and method == 'PUT':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        sid = path.rsplit('/', 1)[-1]
        try:
            payload = json.loads(body or '{}')
            update_fields = {k: v for k, v in payload.items() if k in {'subjectName', 'description'}}
            expr, names, values = [], {}, {}
            if 'subjectName' in update_fields:
                # Ensure unique new name
                subject_name = str(update_fields['subjectName']).strip()
                existing = subjects_table.query(
                    IndexName='SubjectNameIndex',
                    KeyConditionExpression=boto3.dynamodb.conditions.Key('subjectName').eq(subject_name),
                    Limit=1,
                )
                if existing.get('Items') and existing['Items'][0]['subjectId'] != sid:
                    return _response(event, 409, {'error': 'Subject name already exists'})
            for k, v in update_fields.items():
                expr.append(f"#_{k} = :{k}")
                names[f"#_{k}"] = k
                values[f":{k}"] = v
            expr.append('#_updatedAt = :updatedAt')
            names['#_updatedAt'] = 'updatedAt'
            values[':updatedAt'] = _now_iso()
            if not expr:
                return _response(event, 400, {'error': 'No updatable fields provided'})
            res = subjects_table.update_item(
                Key={'subjectId': sid},
                UpdateExpression='SET ' + ', '.join(expr),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ConditionExpression='attribute_exists(subjectId)',
                ReturnValues='ALL_NEW',
            )
            return _response(event, 200, res['Attributes'])
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    if '/subjects/' in path and method == 'DELETE':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        sid = path.rsplit('/', 1)[-1]
        try:
            # Optionally prevent deletion if questions exist for subject
            q = questions_table.query(
                IndexName='SubjectIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('subjectId').eq(sid),
                Limit=1,
            )
            if q.get('Items'):
                return _response(event, 400, {'error': 'Subject has questions; delete them first'})
            subjects_table.delete_item(Key={'subjectId': sid}, ConditionExpression='attribute_exists(subjectId)')
            return _response(event, 204, {})
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    # Questions
    if path.endswith('/questions') and method == 'GET':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        limit = int(qs.get('limit', '50'))
        eks = qs.get('nextToken')
        subject_id = qs.get('subjectId')
        if subject_id:
            query_kwargs = {
                'IndexName': 'SubjectIndex',
                'KeyConditionExpression': boto3.dynamodb.conditions.Key('subjectId').eq(subject_id),
                'Limit': min(limit, 100),
            }
            if eks:
                query_kwargs['ExclusiveStartKey'] = json.loads(eks)
            res = questions_table.query(**query_kwargs)
        else:
            scan_kwargs = {'Limit': min(limit, 100)}
            if eks:
                scan_kwargs['ExclusiveStartKey'] = json.loads(eks)
            res = questions_table.scan(**scan_kwargs)
        return _response(event, 200, {
            'items': res.get('Items', []),
            'nextToken': json.dumps(res['LastEvaluatedKey']) if 'LastEvaluatedKey' in res else None,
        })

    if path.endswith('/questions') and method == 'POST':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        try:
            payload = json.loads(body or '{}')
            for f in ['question', 'options', 'answerIndex', 'subjectId']:
                if f not in payload:
                    return _response(event, 400, {'error': f'Missing field: {f}'})
            options = payload['options']
            if not isinstance(options, list) or len(options) != 4 or not all(isinstance(x, str) for x in options):
                return _response(event, 400, {'error': 'options must be a list of 4 strings'})
            ai = int(payload['answerIndex'])
            if not (0 <= ai <= 3):
                return _response(event, 400, {'error': 'answerIndex must be 0..3'})
            sid = str(payload['subjectId'])
            # Load subject to denormalize subjectName
            s = subjects_table.get_item(Key={'subjectId': sid}).get('Item')
            if not s:
                return _response(event, 400, {'error': 'Invalid subjectId'})
            qid = payload.get('questionId') or _gen_id()
            now = _now_iso()
            item = {
                'questionId': qid,
                'question': str(payload['question']),
                'options': options,
                'answerIndex': ai,
                'tags': payload.get('tags') or [],
                'subjectId': sid,
                'subjectName': s['subjectName'],
                'createdAt': now,
                'updatedAt': now,
            }
            questions_table.put_item(Item=item, ConditionExpression='attribute_not_exists(questionId)')
            return _response(event, 201, item)
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    if '/questions/' in path and method == 'GET':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        qid = path.rsplit('/', 1)[-1]
        res = questions_table.get_item(Key={'questionId': qid})
        item = res.get('Item')
        if not item:
            return _response(event, 404, {'error': 'Not found'})
        return _response(event, 200, item)

    if '/questions/' in path and method == 'PUT':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        qid = path.rsplit('/', 1)[-1]
        try:
            payload = json.loads(body or '{}')
            allowed = {'question', 'options', 'answerIndex', 'tags', 'subjectId'}
            update_fields = {k: v for k, v in payload.items() if k in allowed}
            if 'options' in update_fields:
                options = update_fields['options']
                if not isinstance(options, list) or len(options) != 4 or not all(isinstance(x, str) for x in options):
                    return _response(event, 400, {'error': 'options must be a list of 4 strings'})
            if 'answerIndex' in update_fields:
                ai = int(update_fields['answerIndex'])
                if not (0 <= ai <= 3):
                    return _response(event, 400, {'error': 'answerIndex must be 0..3'})
            if 'subjectId' in update_fields:
                sid = str(update_fields['subjectId'])
                s = subjects_table.get_item(Key={'subjectId': sid}).get('Item')
                if not s:
                    return _response(event, 400, {'error': 'Invalid subjectId'})
            expr, names, values = [], {}, {}
            for k, v in update_fields.items():
                if k == 'subjectId':
                    # also update denormalized subjectName
                    s = subjects_table.get_item(Key={'subjectId': v}).get('Item')
                    expr.append('#_subjectName = :subjectName')
                    names['#_subjectName'] = 'subjectName'
                    values[':subjectName'] = s['subjectName']
                expr.append(f"#_{k} = :{k}")
                names[f"#_{k}"] = k
                values[f":{k}"] = v
            expr.append('#_updatedAt = :updatedAt')
            names['#_updatedAt'] = 'updatedAt'
            values[':updatedAt'] = _now_iso()
            if not expr:
                return _response(event, 400, {'error': 'No updatable fields provided'})
            res = questions_table.update_item(
                Key={'questionId': qid},
                UpdateExpression='SET ' + ', '.join(expr),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ConditionExpression='attribute_exists(questionId)',
                ReturnValues='ALL_NEW',
            )
            return _response(event, 200, res['Attributes'])
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    if '/questions/' in path and method == 'DELETE':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        qid = path.rsplit('/', 1)[-1]
        try:
            questions_table.delete_item(Key={'questionId': qid}, ConditionExpression='attribute_exists(questionId)')
            return _response(event, 204, {})
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    # Quiz (public)
    if method == 'GET' and path.endswith('/quiz'):
        count = max(1, min(int(qs.get('count', '10')), 50))
        subject_id = qs.get('subjectId')
        items = []
        if subject_id:
            q = questions_table.query(
                IndexName='SubjectIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('subjectId').eq(subject_id),
                ProjectionExpression='questionId,question,options,answerIndex',
            )
            items = q.get('Items', [])
        else:
            s = questions_table.scan(ProjectionExpression='questionId,question,options,answerIndex')
            items = s.get('Items', [])
        selected = items if len(items) <= count else random.sample(items, count)
        prepared = []
        for q in selected:
            idxs = list(range(4))
            random.shuffle(idxs)
            shuffled = [q['options'][i] for i in idxs]
            correct_new = idxs.index(int(q['answerIndex']))
            prepared.append({
                'questionId': q['questionId'],
                'question': q['question'],
                'options': shuffled,
                'answerIndex': correct_new,
            })
        return _response(event, 200, {'questions': prepared, 'total': len(prepared)})

    # Bulk upload questions
    if path.endswith('/questions/bulk') and method == 'POST':
        if not _require_admin(event):
            return _response(event, 404, {'error': 'Not found'})
        try:
            payload = json.loads(body or '{}')
            questions_data = payload.get('questions', [])
            
            if not questions_data or not isinstance(questions_data, list):
                return _response(event, 400, {'error': 'questions array is required'})
            
            results = []
            errors = []
            created_subjects = []
            
            for i, q in enumerate(questions_data):
                try:
                    # Validate required fields
                    for f in ['question', 'options', 'answerIndex', 'subject']:
                        if f not in q:
                            errors.append(f'Row {i+1}: Missing field: {f}')
                            continue
                    
                    options = q['options']
                    if not isinstance(options, list) or len(options) != 4 or not all(isinstance(x, str) and x.strip() for x in options):
                        errors.append(f'Row {i+1}: options must be a list of 4 non-empty strings')
                        continue
                    
                    ai = int(q['answerIndex'])
                    if not (0 <= ai <= 3):
                        errors.append(f'Row {i+1}: answerIndex must be 0..3')
                        continue
                    
                    subject_name = str(q['subject']).strip()
                    if not subject_name:
                        errors.append(f'Row {i+1}: subject cannot be empty')
                        continue
                    
                    # Find or create subject
                    subject_scan = subjects_table.scan(
                        FilterExpression=boto3.dynamodb.conditions.Attr('subjectName').eq(subject_name)
                    )
                    existing_subject = subject_scan.get('Items', [])
                    
                    if existing_subject:
                        subject = existing_subject[0]
                    else:
                        # Create new subject
                        subject_id = _gen_id()
                        # Create slug from subject name
                        slug = subject_name.lower().replace(' ', '-').replace('_', '-')
                        slug = ''.join(c for c in slug if c.isalnum() or c == '-')
                        slug = slug[:60]  # Limit length
                        
                        # Check if slug exists and make it unique
                        slug_scan = subjects_table.scan(
                            FilterExpression=boto3.dynamodb.conditions.Attr('slug').eq(slug)
                        )
                        if slug_scan.get('Items'):
                            slug = f"{slug}-{int(datetime.datetime.utcnow().timestamp())}"
                        
                        now = _now_iso()
                        subject = {
                            'subjectId': subject_id,
                            'subjectName': subject_name,
                            'slug': slug,
                            'description': f'Questions for {subject_name}',
                            'createdAt': now,
                            'updatedAt': now,
                        }
                        
                        subjects_table.put_item(Item=subject)
                        created_subjects.append(subject_name)
                    
                    qid = q.get('questionId') or _gen_id()
                    now = _now_iso()
                    
                    item = {
                        'questionId': qid,
                        'question': str(q['question']).strip(),
                        'options': options,
                        'answerIndex': ai,
                        'tags': q.get('tags', []),
                        'subjectId': subject['subjectId'],
                        'subjectName': subject['subjectName'],
                        'createdAt': now,
                        'updatedAt': now,
                    }
                    
                    # Try to insert (skip if exists)
                    try:
                        questions_table.put_item(Item=item, ConditionExpression='attribute_not_exists(questionId)')
                        results.append({'questionId': qid, 'status': 'created', 'subject': subject_name})
                    except questions_table.meta.client.exceptions.ConditionalCheckFailedException:
                        results.append({'questionId': qid, 'status': 'skipped', 'reason': 'already exists', 'subject': subject_name})
                        
                except Exception as e:
                    errors.append(f'Row {i+1}: {str(e)}')
            
            return _response(event, 200, {
                'processed': len(questions_data),
                'successful': len([r for r in results if r['status'] == 'created']),
                'skipped': len([r for r in results if r['status'] == 'skipped']),
                'errors': len(errors),
                'created_subjects': list(set(created_subjects)),
                'results': results,
                'error_details': errors
            })
            
        except Exception as e:
            return _response(event, 500, {'error': str(e)})

    return _response(event, 404, {'error': 'Route not found', 'path': path})


def _gen_id():
    import time, uuid
    return f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"


