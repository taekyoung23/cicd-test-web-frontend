# Frontend Deployment Runbook

## 1. 문서 개요

이 문서는 `frontend-cicd` Jenkins Pipeline 실패 시 운영자가 장애 원인을 빠르게 분리하고, 안전하게 재시도 또는 복구하기 위한 운영 Runbook이다.

적용 범위는 SecureVoiceGuard 프론트엔드 정적 사이트 배포이다.

- GitHub Repository: `taekyoung23/cicd-test-web-frontend`
- Branch: `ktk-cicd`
- Jenkins Job: `frontend-cicd`
- S3 Web Bucket: `mzc-securevoiceguard-web-dev`
- CloudFront Distribution ID: `E2ZAHL4TTM1M8O`
- Service URL: `https://mzmt.shop`
- 배포 파일: `index.html`, `app.js`, `style.css`

이 Runbook이 다루는 장애 범위:

- GitHub Webhook 트리거 실패
- Jenkins checkout 실패
- 정적 파일 검증 실패
- S3 업로드 실패
- CloudFront Invalidation 실패
- 배포 후 도메인 및 asset 응답 검증 실패
- Slack 알림 실패
- Deployment Summary artifact 누락

이 Runbook이 다루지 않는 범위:

- API Service 장애
- AI Worker 장애
- ECS Task 장애
- RDS/SQS inference 처리 장애
- 모델 추론 장애
- Terraform apply 장애

## 2. 아키텍처 및 배포 흐름

프론트엔드 배포 흐름은 다음과 같다.

```text
GitHub ktk-cicd push
→ Jenkins frontend-cicd
→ Source Checkout
→ Static File Validation
→ S3 Upload
→ CloudFront Invalidation
→ Post-Deploy Verification
→ Slack Notification
```

운영 관점의 요청 흐름은 다음과 같다.

```text
GitHub
→ Jenkins frontend-cicd
→ S3 Web Bucket
→ CloudFront
→ 사용자 브라우저
```

프론트엔드는 `index.html`, `app.js`, `style.css`를 S3에 업로드하고 CloudFront 캐시 무효화를 수행한다. 사용자는 `https://mzmt.shop` 도메인으로 CloudFront를 통해 정적 파일을 내려받는다.

`/api/*` 요청은 프론트엔드가 직접 처리하지 않는다. 브라우저에서 발생한 API 요청은 기존 CloudFront/ALB/API 경로로 전달되며, API Service 장애나 Worker 처리 장애는 이 Runbook의 직접 대응 범위가 아니다.

## 3. 정상 배포 기준

아래 조건을 모두 만족하면 프론트엔드 배포가 정상 완료된 것으로 판단한다.

- Jenkins build result가 `SUCCESS`
- `Static File Validation` stage 통과
- S3에 `index.html`, `app.js`, `style.css` 업로드 완료
- CloudFront Invalidation ID가 생성됨
- CloudFront Invalidation status가 `Completed`
- `https://mzmt.shop/` HTTP 200 응답
- HTML 응답에 `SecureVoiceGuard` 문자열 포함
- `https://mzmt.shop/app.js` 응답 성공
- `https://mzmt.shop/style.css` 응답 성공
- Slack 성공 알림 수신
- Deployment Summary artifact 생성

## 4. 장애 대응 우선순위

### 4.1 Jenkins 실행 자체가 안 됨

#### 증상

- Jenkins UI에 접속할 수 없다.
- `frontend-cicd` Job이 실행되지 않는다.
- 수동 `Build Now` 버튼을 눌러도 빌드가 시작되지 않는다.

#### 주요 원인

- Jenkins 서비스 장애
- Jenkins EC2 또는 Jenkins 컨테이너 장애
- Jenkins executor 부족
- Jenkins UI 접근 경로 문제

#### 확인 방법

- Jenkins UI 접속 가능 여부 확인
- Jenkins Job queue 상태 확인
- Jenkins 관리 화면에서 node/executor 상태 확인
- 인프라 장애가 의심되면 Jenkins EC2 상태 확인

#### 조치 방법

- 일시적인 queue 문제면 대기 후 재시도
- Jenkins 자체 장애면 Jenkins 운영 담당자에게 에스컬레이션
- 프론트 파일 긴급 반영이 필요하면 Jenkins 복구 후 재배포를 우선한다.

#### 재시도 기준

- Jenkins UI가 정상 접속되고 executor가 사용 가능한 상태
- `frontend-cicd` Job에서 수동 `Build Now` 실행 가능

### 4.2 GitHub Webhook이 Jenkins를 트리거하지 못함

#### 증상

- GitHub에 push했지만 Jenkins build가 자동 시작되지 않는다.
- Jenkins build 원인에 `Started by GitHub push`가 없다.

#### 주요 원인

- GitHub Webhook 미설정 또는 비활성화
- Payload URL 오타
- Webhook Secret mismatch
- Jenkins `/github-webhook/` endpoint 접근 실패
- GitHub Recent Deliveries 실패

#### 확인 방법

- GitHub Repository Webhooks에서 Recent Deliveries 확인
- `ping` 이벤트와 `push` 이벤트가 HTTP 200인지 확인
- Jenkins build 원인이 `Started by GitHub push`인지 확인

#### 조치 방법

- Payload URL, Content type, push event, Active 상태 확인
- Secret mismatch가 의심되면 기존 Jenkins/GitHub shared secret으로 재설정
- Webhook 장애 중에는 Jenkins `Build Now`로 수동 배포 가능

#### 재시도 기준

- GitHub Recent Deliveries에서 push 이벤트가 200으로 응답
- 작은 commit push 후 `frontend-cicd`가 자동 시작됨

### 4.3 Source Checkout 실패

#### 증상

- `Source Checkout` stage에서 실패
- Git clone/fetch/checkout 오류 발생
- Jenkins가 `Jenkinsfile`을 가져오지 못함

#### 주요 원인

- GitHub credential 문제
- Repository URL 오류
- Branch Specifier 오류
- Script Path 오류
- GitHub token 권한 부족

#### 확인 방법

- Jenkins Job 설정 확인
  - Repository URL: `https://github.com/taekyoung23/cicd-test-web-frontend.git`
  - Branch Specifier: `*/ktk-cicd`
  - Script Path: `Jenkinsfile`
  - Credentials: 기존 GitHub token credential
- Jenkins Console Log에서 Git 인증/checkout 오류 확인

#### 조치 방법

- Job 설정값을 기존 API/Worker Job 설정과 비교
- GitHub token 권한 확인
- Branch 또는 Jenkinsfile 경로가 변경되었는지 확인

#### 재시도 기준

- Jenkins가 `ktk-cicd` branch의 `Jenkinsfile`을 정상 checkout할 수 있음

### 4.4 Static File Validation 실패

#### 증상

- `Static File Validation` stage에서 실패
- 필수 파일 누락 또는 grep 검증 실패

#### 주요 원인

- `index.html`, `app.js`, `style.css` 누락
- 파일이 비어 있음
- `index.html`에서 `./style.css` 또는 `./app.js` 참조 누락
- `app.js`에서 주요 API 경로 문자열 누락

#### 확인 방법

로컬 또는 GitHub에서 아래 항목을 확인한다.

```bash
test -s index.html
test -s app.js
test -s style.css
grep -q './style.css' index.html
grep -q './app.js' index.html
grep -q '/api/login' app.js
grep -q '/api/analysis/request' app.js
grep -q '/api/guest' app.js
```

#### 조치 방법

- 누락된 파일 또는 참조를 복구
- 잘못 변경된 API path를 원래 의도한 값으로 수정
- 수정 commit 후 재배포

#### 재시도 기준

- 필수 파일 3개가 존재하고 non-empty
- HTML/CSS/JS 참조와 주요 API path 검증이 모두 통과

### 4.5 S3 Upload 실패

#### 증상

- `S3 Upload` stage에서 실패
- `AccessDenied`, `NoSuchBucket`, `ExpiredToken` 등 AWS CLI 오류 발생
- S3에 파일이 갱신되지 않음

#### 주요 원인

- Jenkins EC2 IAM Role 권한 부족
- S3 bucket 이름 오류
- AWS CLI 인증 문제
- S3 service 일시 장애

#### 확인 방법

- Jenkins Role: `securevoice-dev-jenkins-role`
- 연결 정책: `securevoice-dev-jenkins-frontend-deploy-policy`
- S3 Bucket: `mzc-securevoiceguard-web-dev`
- 업로드 대상 객체:
  - `index.html`
  - `app.js`
  - `style.css`
- 필요한 권한:
  - `s3:ListBucket`
  - `s3:GetObject`
  - `s3:PutObject`
  - `s3:DeleteObject`

AWS Console에서 `mzc-securevoiceguard-web-dev` bucket의 object 갱신 시간을 확인한다.

#### 조치 방법

- Jenkins Role에 frontend deploy policy가 연결되어 있는지 확인
- bucket 이름과 object key를 Jenkinsfile 기준으로 재확인
- 권한 문제가 맞으면 IAM 정책을 확인하되, Terraform apply로 즉시 해결하려 하지 않는다.

#### 재시도 기준

- Jenkins Role이 S3 대상 bucket/object에 필요한 최소 권한을 보유
- S3 Console에서 object 업로드가 가능한 상태

### 4.6 CloudFront Invalidation 실패

#### 증상

- `CloudFront Invalidation` stage에서 실패
- Invalidation ID가 `N/A`, `None`, `null`, 빈 값으로 표시
- `aws cloudfront wait invalidation-completed` 실패 또는 timeout

#### 주요 원인

- CloudFront 권한 부족
- Distribution ID 오류
- Invalidation 생성은 되었지만 상태 대기 중 timeout
- CloudFront 일시 장애

#### 확인 방법

- Distribution ID: `E2ZAHL4TTM1M8O`
- Jenkins Console Log에서 `Parsed CloudFront invalidation ID` 확인
- Invalidation ID가 `N/A`가 아닌 실제 값인지 확인
- AWS Console에서 Invalidation status가 `Completed`인지 확인
- 필요한 권한:
  - `cloudfront:CreateInvalidation`
  - `cloudfront:GetInvalidation`

#### 조치 방법

- Invalidation ID가 생성되지 않았다면 CloudFront 권한과 Distribution ID 확인
- Invalidation이 생성되었지만 wait가 실패했다면 AWS Console에서 해당 Invalidation 상태 확인
- Completed 상태라면 수동으로 `Post-Deploy Verification` 기준을 확인하고 Jenkins 재실행

#### 재시도 기준

- Invalidation ID가 실제 값으로 생성됨
- Invalidation status가 `Completed`

### 4.7 Post-Deploy Verification 실패

#### 증상

- `Post-Deploy Verification` stage에서 실패
- `https://mzmt.shop/` HTTP 200 실패
- HTML에 `SecureVoiceGuard` 문자열이 없음
- `/app.js` 또는 `/style.css` 응답 실패

#### 주요 원인

- CloudFront 캐시 반영 지연
- S3 object 업로드 누락
- CloudFront origin 또는 behavior 문제
- 잘못된 HTML 파일 배포
- DNS 또는 TLS 경로 문제

#### 확인 방법

```bash
curl -I https://mzmt.shop/
curl -I https://mzmt.shop/app.js
curl -I https://mzmt.shop/style.css
curl -s https://mzmt.shop/ | grep SecureVoiceGuard
```

AWS Console에서 CloudFront Invalidation이 Completed인지 확인한다.

#### 조치 방법

- CloudFront Invalidation 완료 여부 확인
- S3 object의 Last modified 확인
- HTML에 `SecureVoiceGuard` 문자열이 실제로 포함되어 있는지 확인
- 캐시 반영 지연 가능성이 있으면 잠시 후 Jenkins 재실행

#### 재시도 기준

- CloudFront Invalidation Completed
- S3 object가 최신 버전
- 도메인과 asset URL이 HTTP 200으로 응답

### 4.8 Slack Notification 실패

#### 증상

- Jenkins 배포는 성공/실패했지만 Slack 알림이 오지 않음
- Jenkins Console Log에 `Slack notification failed but ignored` 출력

#### 주요 원인

- Jenkins credential `slack-webhook-url` 문제
- Slack Webhook URL 만료 또는 삭제
- Slack API 일시 장애
- 네트워크 연결 문제

#### 확인 방법

- Jenkins credential ID: `slack-webhook-url`
- Jenkins Console Log에서 Slack 전송 결과 확인
- Slack Webhook URL 실제 값은 문서나 로그에 노출하지 않음

#### 조치 방법

- Slack credential 존재 여부 확인
- Webhook URL이 유효한지 Jenkins 관리자 권한으로 확인
- Slack 알림 실패는 배포 실패와 동일한 의미가 아니다. 배포 성공 여부는 Jenkins stage와 verification 결과를 기준으로 판단한다.

#### 재시도 기준

- Jenkins credential이 정상이고 Slack endpoint가 응답 가능

### 4.9 Deployment Summary artifact 누락

#### 증상

- Jenkins Artifacts에 `deployment-summary-frontend-<BUILD_NUMBER>.json`이 없음
- Slack 알림은 왔지만 summary 파일이 보이지 않음

#### 주요 원인

- `Deployment Summary` stage가 실행되기 전 실패
- post unsuccessful에서 summary 생성 실패
- workspace 권한 문제
- archiveArtifacts 설정 문제

#### 확인 방법

- Jenkins Console Log에서 `deployment-summaries` 디렉터리 생성 여부 확인
- Artifact 목록 확인
- Pipeline 실패 지점이 summary 생성 전인지 확인

#### 조치 방법

- 실패 stage를 먼저 해결
- summary 누락만 발생했다면 Jenkinsfile의 summary 생성 로그 확인
- 배포 결과 판단은 summary만 보지 말고 Jenkins stage와 Console Log를 함께 본다.

#### 재시도 기준

- Pipeline 재실행 후 summary artifact가 생성되고 fingerprint 기록됨

## 5. Stage별 상세 장애 대응

### Source Checkout

확인 항목:

- Jenkins credential
- GitHub repo URL
- Branch Specifier: `*/ktk-cicd`
- Script Path: `Jenkinsfile`
- GitHub token 권한
- Jenkins Console Log

Jenkins Job 설정에서 SCM 값이 기존 API/Worker Job과 같은 방식인지 확인한다. Secret/token 값은 문서나 Slack에 공유하지 않는다.

### Static File Validation

확인 항목:

- `index.html`, `app.js`, `style.css` 존재 여부
- 파일이 비어 있지 않은지
- `index.html`에서 `./style.css`, `./app.js` 참조 여부
- `app.js`에서 `/api/login`, `/api/analysis/request`, `/api/guest` 문자열 확인

이 stage는 S3 업로드 전 단계이므로 실패해도 AWS 배포 대상에는 영향이 없다.

### S3 Upload

확인 항목:

- Jenkins Role: `securevoice-dev-jenkins-role`
- 연결 정책: `securevoice-dev-jenkins-frontend-deploy-policy`
- S3 Bucket: `mzc-securevoiceguard-web-dev`
- 업로드 대상 객체:
  - `index.html`
  - `app.js`
  - `style.css`
- 권한:
  - `s3:ListBucket`
  - `s3:GetObject`
  - `s3:PutObject`
  - `s3:DeleteObject`

현재 Pipeline은 `aws s3 sync --delete`를 사용하지 않고, 파일 3개만 `aws s3 cp`로 명시적으로 업로드한다.

### CloudFront Invalidation

확인 항목:

- Distribution ID: `E2ZAHL4TTM1M8O`
- Invalidation ID가 `N/A`가 아닌 실제 값인지 확인
- Invalidation status가 `Completed`인지 확인
- 권한:
  - `cloudfront:CreateInvalidation`
  - `cloudfront:GetInvalidation`

AWS Console 확인 위치:

```text
CloudFront
→ Distribution E2ZAHL4TTM1M8O
→ Invalidations
```

Slack의 Invalidation ID와 AWS Console의 Invalidation ID가 일치하면 CloudFront 캐시 무효화 요청 증적으로 사용할 수 있다.

### Post-Deploy Verification

확인 항목:

- `https://mzmt.shop/`
- `https://mzmt.shop/app.js`
- `https://mzmt.shop/style.css`
- CloudFront 캐시 반영 지연 가능성
- 5xx/4xx 여부
- 응답 HTML에 `SecureVoiceGuard` 포함 여부

검증 실패 시 CloudFront Invalidation 완료 여부와 S3 object 최신 여부를 먼저 확인한다.

### Slack Notification

확인 항목:

- Jenkins credential ID: `slack-webhook-url`
- 성공 알림에는 Runbook 링크 없음
- 실패 알림에는 Runbook 링크 포함
- Slack 실패가 배포 실패와 동일한 의미는 아님

Slack Webhook URL 실제 값은 문서, 콘솔 로그, Slack 메시지에 노출하지 않는다.

## 6. GitHub Webhook 장애 대응

Frontend repo webhook 설정 기준:

- Payload URL: `http://securevoice-dev-api-alb-537121418.ap-northeast-2.elb.amazonaws.com/github-webhook/`
- Content type: `application/json`
- Event: `Just the push event`
- Secret: 기존 Jenkins/GitHub shared secret
- Active: enabled

확인 항목:

- GitHub Recent Deliveries
- `ping` 이벤트 200 여부
- `push` 이벤트 200 여부
- Jenkins build 원인에 `Started by GitHub push`가 찍히는지
- Secret mismatch 시 기존 Jenkins/GitHub shared secret으로 재설정 필요

주의 사항:

- Webhook Secret은 AWS Access Key가 아니다.
- Webhook Secret은 AWS Secret Access Key가 아니다.
- Webhook Secret은 GitHub PAT가 아니다.
- Webhook Secret은 Slack Webhook URL이 아니다.
- Webhook Secret은 GitHub가 Jenkins `/github-webhook/` 요청에 서명할 때 사용하는 shared secret이다.

API/Worker webhook에 영향이 없도록 Jenkins 전역 shared secret을 변경하지 않는다. Frontend repo에는 기존 API/Worker와 동일한 shared secret을 입력한다.

## 7. 수동 복구 절차

Pipeline 실패 시 아래 순서로 대응한다.

1. Jenkins `frontend-cicd` build result와 실패 stage 확인
2. Jenkins Console Log에서 실패 stage 주변 로그 확인
3. S3 Console에서 `index.html`, `app.js`, `style.css` object 상태 확인
4. CloudFront Console에서 Invalidation ID와 status 확인
5. `https://mzmt.shop/`, `/app.js`, `/style.css` 응답 확인
6. 원인이 해결되면 Jenkins에서 `Build Now`로 재실행
7. Webhook 장애라면 수동 `Build Now`로 우회 가능
8. 프론트 파일 자체가 잘못된 경우 GitHub에서 수정 commit 후 재배포

주의:

- Terraform apply로 프론트 배포 실패를 해결하려 하지 않는다.
- Jenkins EC2, EBS, Security Group, Instance Profile, ECS, ALB 등 공유 인프라를 즉시 수정하지 않는다.
- 배포 실패 원인이 권한이라면 Jenkins Role 정책을 확인하되, 운영 반영 전 변경 범위를 분리해서 검토한다.

## 8. Rollback 기준

현재 프론트엔드 CI/CD에는 자동 rollback이 없다.

프론트엔드는 Docker/ECR/ECS 배포가 아니라 S3 정적 파일 업로드와 CloudFront Invalidation 기반 배포이다. 따라서 API/Worker처럼 ECS Service revision을 baseline으로 되돌리는 자동 rollback 구조가 아니다.

수동 rollback 예시:

1. 이전 정상 commit으로 revert commit 생성
2. Jenkins Pipeline 재실행
3. S3에 이전 버전의 `index.html`, `app.js`, `style.css` 재업로드
4. CloudFront Invalidation 재생성
5. `https://mzmt.shop` 및 정적 asset 응답 검증

주의:

- `aws s3 sync --delete`를 사용하지 않는다.
- 현재는 파일 3개만 명시적으로 배포한다.
- 운영 고도화 시 S3 versioning 또는 배포 artifact 백업 기반 rollback을 검토할 수 있다.

## 9. 보안 및 운영 주의사항

- AWS Access Key를 Jenkins Credential에 직접 저장하지 않는다.
- Jenkins는 EC2 IAM Role 기반으로 AWS CLI를 실행한다.
- Jenkins Role: `securevoice-dev-jenkins-role`
- 프론트 배포용 최소 권한 정책: `securevoice-dev-jenkins-frontend-deploy-policy`
- GitHub Webhook Secret은 GitHub Token과 다르다.
- Slack Webhook URL은 문서에 노출하지 않는다.
- GitHub token, Webhook Secret, Slack Webhook URL, AWS credential 값은 Runbook에 기록하지 않는다.
- 이번 프론트 CI/CD 검증에서는 Terraform apply를 수행하지 않았다.
- Jenkins Role에 프론트 배포용 최소 권한 policy를 별도 부여했다.
- 추후 운영 기준에서는 이 수동 권한을 Terraform 코드로 흡수해 drift를 제거해야 한다.

## 10. 보고서/발표용 요약

SecureVoiceGuard 프론트엔드 CI/CD는 Docker/ECR/ECS 배포가 아니라 S3 정적 파일 배포와 CloudFront Invalidation 중심으로 구성했다. Jenkins는 GitHub `ktk-cicd` branch push를 Webhook으로 받아 `index.html`, `app.js`, `style.css`를 검증한 뒤 S3 Web Bucket에 명시적으로 업로드하고, CloudFront Invalidation 완료 후 `https://mzmt.shop` 도메인과 정적 asset 응답을 검증한다.

AWS 작업은 Jenkins EC2 IAM Role 기반 최소 권한으로 수행했으며, 성공/실패 결과는 Slack으로 알림을 보낸다. 이번 프론트 CI/CD 검증에서는 Terraform-managed Jenkins 인프라를 변경하지 않았고, 콘솔에서 수동 부여한 프론트 배포 권한은 추후 Terraform 코드로 흡수해 drift를 제거하는 방향으로 정리한다.
