#!/usr/bin/env python3
"""전용 Desktop OAuth 인증을 저장소 밖에 저장한다. 기존 clasp 인증은 바꾸지 않는다."""
import argparse
import json
import os
from pathlib import Path
import re
import sys


class SetupError(ValueError):
    pass

def main():
    parser = argparse.ArgumentParser(description='REST 미리보기 최초 OAuth 인증')
    parser.add_argument('--client', required=True, help='Google에서 받은 Desktop OAuth JSON 경로')
    parser.add_argument('--project-number', required=True)
    parser.add_argument('--deployment-id', required=True)
    parser.add_argument('--scope', action='append', required=True, help='스크립트 개요의 모든 OAuth 범위, 각각 지정')
    parser.add_argument('--config', default=str(Path.home() / '.config/newacts-apps-script/registration.json'))
    args = parser.parse_args()
    output = Path(args.config).expanduser().resolve()
    repo = Path(__file__).resolve().parents[1]
    if output.is_relative_to(repo):
        raise SetupError('인증 파일은 저장소 밖에 보관하세요.')
    if output.exists():
        raise SetupError('기존 전용 인증 설정이 있습니다. 덮어쓰지 않았습니다.')
    try:
        client = json.loads(Path(args.client).expanduser().read_text())['installed']
    except (OSError, ValueError, KeyError):
        raise SetupError('Desktop OAuth JSON을 읽을 수 없습니다.') from None
    if not args.project_number.isdigit() or client.get('client_id', '').split('-')[0] != args.project_number:
        raise SetupError('OAuth 클라이언트와 지정한 Cloud 프로젝트가 다릅니다.')
    if not re.fullmatch(r'AKfy[\w-]+', args.deployment_id):
        raise SetupError('실행 API 배포 ID를 지정하세요.')
    allowed = 'https://www.googleapis.com/auth/'
    if any(not scope.startswith(allowed) for scope in args.scope):
        raise SetupError('Google OAuth 범위만 사용할 수 있습니다.')
    from google_auth_oauthlib.flow import InstalledAppFlow
    scopes = list(dict.fromkeys(args.scope + [allowed + 'script.deployments.readonly']))
    # 클라이언트 JSON의 인증 서버 주소 대신 공식 Google 서버만 사용한다.
    client['auth_uri'] = 'https://accounts.google.com/o/oauth2/auth'
    client['token_uri'] = 'https://oauth2.googleapis.com/token'
    flow = InstalledAppFlow.from_client_config({'installed': client}, scopes, autogenerate_code_verifier=True)
    credentials = flow.run_local_server(
        host='127.0.0.1', port=0, open_browser=False, timeout_seconds=300,
        authorization_prompt_message='Google 인증 주소를 브라우저에서 여세요: {url}',
        success_message='인증을 받았습니다. 이 창을 닫아도 됩니다.',
        access_type='offline', prompt='consent')
    if not credentials.refresh_token:
        raise SetupError('갱신 토큰이 없습니다. 인증 파일을 저장하지 않았습니다.')
    config = {'projectNumber': args.project_number, 'deploymentId': args.deployment_id,
              'client_id': client['client_id'], 'client_secret': client['client_secret'],
              'refresh_token': credentials.refresh_token}
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump(config, file)
    print('전용 인증을 저장했습니다. 토큰과 비밀값은 출력하지 않습니다.')


if __name__ == '__main__':
    try:
        main()
    except SetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Google 인증이 완료되지 않았습니다. 전용 설정을 저장하지 않았습니다.', file=sys.stderr)
        sys.exit(1)
