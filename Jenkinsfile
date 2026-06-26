def slackDisplay(value) {
    return value == null || value.toString().trim() == '' ? 'N/A' : value.toString()
}

def slackSection(Map details) {
    return details.collect { key, value ->
        "- ${key}: ${slackDisplay(value)}"
    }.join('\n')
}

def frontendRunbookLink() {
    return '<https://github.com/taekyoung23/cicd-test-web-frontend/blob/ktk-cicd/docs/runbooks/frontend-deployment-runbook.md|운영 가이드>'
}

def sendSlackNotification(String title, Map details) {
    String messageFile = ".slack-message-${env.BUILD_NUMBER ?: 'unknown'}.txt"
    String payloadFile = ".slack-payload-${env.BUILD_NUMBER ?: 'unknown'}.json"
    try {
        String body = ([title] + details.collect { key, value ->
            String displayValue = slackDisplay(value)
            displayValue.contains('\n') ? "*${key}:*\n${displayValue}" : "*${key}:* ${displayValue}"
        }).join('\n\n')
        writeFile(file: messageFile, text: body)
        withCredentials([
            string(credentialsId: 'slack-webhook-url', variable: 'SLACK_WEBHOOK_URL')
        ]) {
            int slackStatus = sh(
                returnStatus: true,
                script: """
                    set +x
                    set -e
                    python3 - '${messageFile}' '${payloadFile}' <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as message_file:
    message = message_file.read()

with open(sys.argv[2], "w", encoding="utf-8") as payload_file:
    json.dump({"text": message}, payload_file)
PY
                    curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
                      --header 'Content-Type: application/json' \
                      --data-binary @'${payloadFile}' \
                      "\${SLACK_WEBHOOK_URL}" >/dev/null
                """
            )
            if (slackStatus == 0) {
                echo 'Slack notification sent'
            } else {
                echo "Slack notification failed but ignored. Exit code: ${slackStatus}"
            }
        }
    } catch (Exception ignored) {
        echo 'Slack notification failed but ignored'
    } finally {
        try {
            sh(returnStatus: true, script: "rm -f '${messageFile}' '${payloadFile}'")
        } catch (Exception ignored) {
            echo 'Slack notification payload cleanup failed but ignored'
        }
    }
}

def writeFrontendSummary(String buildResult) {
    sh(
        returnStatus: true,
        script: '''
            set +e
            mkdir -p "${DEPLOYMENT_SUMMARY_DIR}"
            python3 - <<'PY'
import datetime
import json
import os

def value(name):
    result = os.environ.get(name)
    return result if result else "N/A"

summary = {
    "schema_version": "1.0",
    "service_type": "frontend",
    "job_name": value("JOB_NAME"),
    "build_number": value("BUILD_NUMBER"),
    "build_result": value("SUMMARY_BUILD_RESULT"),
    "repo": value("REPOSITORY_NAME"),
    "branch": value("GIT_BRANCH_NAME"),
    "commit": value("GIT_COMMIT_SHA"),
    "short_sha": value("GIT_SHORT_SHA"),
    "s3_bucket": value("S3_BUCKET"),
    "cloudfront_distribution_id": value("CLOUDFRONT_DISTRIBUTION_ID"),
    "invalidation_id": value("CLOUDFRONT_INVALIDATION_ID"),
    "domain": value("FRONTEND_URL"),
    "verification_result": value("VERIFICATION_RESULT"),
    "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}

summary_path = (
    f"{value('DEPLOYMENT_SUMMARY_DIR')}/"
    f"deployment-summary-frontend-{value('BUILD_NUMBER')}.json"
)
with open(summary_path, "w", encoding="utf-8") as summary_file:
    json.dump(summary, summary_file, indent=2, ensure_ascii=False)
PY
        '''
    )
}

pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(daysToKeepStr: '14', numToKeepStr: '20'))
        skipDefaultCheckout(true)
        timeout(time: 20, unit: 'MINUTES')
    }

    environment {
        AWS_REGION = 'ap-northeast-2'
        REPOSITORY_NAME = 'cicd-test-web-frontend'
        TARGET_BRANCH = 'ktk-cicd'
        S3_BUCKET = 'mzc-securevoiceguard-web-dev'
        CLOUDFRONT_DISTRIBUTION_ID = 'E2ZAHL4TTM1M8O'
        FRONTEND_URL = 'https://mzmt.shop'
        DEPLOYMENT_SUMMARY_DIR = 'deployment-summaries'
        DEPLOY_PHASE = 'PIPELINE_INITIALIZED'
        VERIFICATION_RESULT = 'NOT_RUN'
        CLOUDFRONT_INVALIDATION_ID = 'N/A'
    }

    stages {
        stage('Source Checkout') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'SOURCE_CHECKOUT'
                }
                checkout(scm)
                script {
                    env.GIT_COMMIT_SHA = sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true
                    ).trim()
                    env.GIT_SHORT_SHA = sh(
                        script: 'git rev-parse --short=7 HEAD',
                        returnStdout: true
                    ).trim()
                    String branchName = sh(
                        script: 'git branch --show-current || true',
                        returnStdout: true
                    ).trim()
                    env.GIT_BRANCH_NAME = branchName && branchName != 'HEAD' ? branchName : env.TARGET_BRANCH
                    echo "Frontend commit: ${env.GIT_COMMIT_SHA}"
                    echo "Frontend short SHA: ${env.GIT_SHORT_SHA}"
                    echo "Frontend branch: ${env.GIT_BRANCH_NAME}"
                }
            }
        }

        stage('Static File Validation') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'STATIC_FILE_VALIDATION'
                }
                sh '''
                    set -eu

                    test -s index.html
                    test -s app.js
                    test -s style.css

                    grep -q './style.css' index.html
                    grep -q './app.js' index.html

                    grep -q '/api/login' app.js
                    grep -q '/api/analysis/request' app.js
                    grep -q '/api/guest' app.js

                    echo "Static file validation passed."
                '''
            }
        }

        stage('S3 Upload') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'S3_UPLOAD'
                }
                sh '''
                    set -eu

                    aws s3 cp index.html "s3://${S3_BUCKET}/index.html" \
                      --content-type "text/html; charset=utf-8" \
                      --cache-control "no-cache, no-store, must-revalidate"

                    aws s3 cp app.js "s3://${S3_BUCKET}/app.js" \
                      --content-type "application/javascript; charset=utf-8" \
                      --cache-control "no-cache, no-store, must-revalidate"

                    aws s3 cp style.css "s3://${S3_BUCKET}/style.css" \
                      --content-type "text/css; charset=utf-8" \
                      --cache-control "no-cache, no-store, must-revalidate"

                    echo "Frontend files uploaded to s3://${S3_BUCKET}"
                '''
            }
        }

        stage('CloudFront Invalidation') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'CLOUDFRONT_INVALIDATION'
                }
                script {
                    sh '''
                            set -eu
                            rm -f cloudfront-invalidation.json cloudfront-invalidation-id.txt

                            aws cloudfront create-invalidation \
                              --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
                              --paths "/" "/index.html" "/app.js" "/style.css" \
                              --output json > cloudfront-invalidation.json

                            python3 - <<'PY'
import json
import sys

with open("cloudfront-invalidation.json", "r", encoding="utf-8") as response_file:
    response = json.load(response_file)

invalidation_id = response.get("Invalidation", {}).get("Id")
if not invalidation_id or invalidation_id in {"N/A", "None", "null"}:
    print("CloudFront invalidation ID was not returned.", file=sys.stderr)
    print(json.dumps(response, indent=2), file=sys.stderr)
    sys.exit(1)

with open("cloudfront-invalidation-id.txt", "w", encoding="utf-8") as id_file:
    id_file.write(invalidation_id)
PY
                    '''
                    env.CLOUDFRONT_INVALIDATION_ID = readFile('cloudfront-invalidation-id.txt').trim()
                    if (!env.CLOUDFRONT_INVALIDATION_ID ||
                        ['N/A', 'None', 'null'].contains(env.CLOUDFRONT_INVALIDATION_ID)) {
                        error('CloudFront invalidation ID was not returned.')
                    }
                    echo "CloudFront invalidation ID: ${env.CLOUDFRONT_INVALIDATION_ID}"
                }
                sh '''
                    set -eu
                    timeout 10m aws cloudfront wait invalidation-completed \
                      --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
                      --id "${CLOUDFRONT_INVALIDATION_ID}"
                    echo "CloudFront invalidation completed: ${CLOUDFRONT_INVALIDATION_ID}"
                '''
            }
        }

        stage('Post-Deploy Verification') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'POST_DEPLOY_VERIFICATION'
                }
                sh '''
                    set -eu

                    for attempt in 1 2 3 4 5; do
                      echo "Frontend post-deploy verification attempt ${attempt}/5"
                      rm -f frontend-index.html frontend-app.js frontend-style.css

                      if curl --fail --silent --show-error --location "${FRONTEND_URL}/" -o frontend-index.html && \
                         grep -q 'SecureVoiceGuard' frontend-index.html && \
                         curl --fail --silent --show-error --location "${FRONTEND_URL}/app.js" -o frontend-app.js && \
                         curl --fail --silent --show-error --location "${FRONTEND_URL}/style.css" -o frontend-style.css; then
                        echo "Frontend post-deploy verification passed."
                        exit 0
                      fi

                      if [ "${attempt}" -lt 5 ]; then
                        sleep 10
                      fi
                    done

                    echo "Frontend post-deploy verification failed."
                    exit 1
                '''
                script {
                    env.VERIFICATION_RESULT = 'PASSED'
                }
            }
        }

        stage('Deployment Summary') {
            steps {
                script {
                    env.DEPLOY_PHASE = 'DEPLOY_SUCCESS'
                    env.SUMMARY_BUILD_RESULT = 'SUCCESS'
                    writeFrontendSummary('SUCCESS')
                }
            }
        }
    }

    post {
        success {
            script {
                sendSlackNotification(':white_check_mark: Frontend 배포 성공', [
                    '핵심 상태': slackSection([
                        Build : "#${env.BUILD_NUMBER}",
                        Result: 'SUCCESS',
                        Phase : env.DEPLOY_PHASE
                    ]),
                    '배포 정보': slackSection([
                        Repo        : env.REPOSITORY_NAME,
                        Branch      : env.GIT_BRANCH_NAME,
                        Commit      : env.GIT_SHORT_SHA,
                        'S3 Bucket' : env.S3_BUCKET,
                        CloudFront  : env.CLOUDFRONT_DISTRIBUTION_ID,
                        Invalidation: env.CLOUDFRONT_INVALIDATION_ID
                    ]),
                    '검증': slackSection([
                        Domain         : env.FRONTEND_URL,
                        'HTTP Status'  : '200',
                        'Content Check': 'SecureVoiceGuard OK',
                        Assets         : 'app.js/style.css OK'
                    ]),
                    '링크': slackSection([
                        Jenkins: env.BUILD_URL
                    ])
                ])
            }
        }
        unsuccessful {
            script {
                env.SUMMARY_BUILD_RESULT = currentBuild.currentResult ?: 'FAILED'
                if (env.VERIFICATION_RESULT == 'NOT_RUN') {
                    env.VERIFICATION_RESULT = 'FAILED'
                }
                writeFrontendSummary(env.SUMMARY_BUILD_RESULT)
                sendSlackNotification(':x: Frontend 배포 실패', [
                    '핵심 상태': slackSection([
                        Build         : "#${env.BUILD_NUMBER}",
                        Result        : 'FAILED',
                        'Failed Stage': env.DEPLOY_PHASE
                    ]),
                    '배포 정보': slackSection([
                        Repo        : env.REPOSITORY_NAME,
                        Branch      : env.GIT_BRANCH_NAME ?: env.TARGET_BRANCH,
                        Commit      : env.GIT_SHORT_SHA ?: 'N/A',
                        'S3 Bucket' : env.S3_BUCKET,
                        CloudFront  : env.CLOUDFRONT_DISTRIBUTION_ID
                    ]),
                    '다음 확인': slackSection([
                        '1': 'Jenkins Console Log',
                        '2': 'S3 업로드 결과',
                        '3': 'CloudFront Invalidation 상태',
                        '4': "${env.FRONTEND_URL} 응답",
                        '5': 'CloudFront 캐시 반영 여부'
                    ]),
                    '링크': slackSection([
                        Jenkins: env.BUILD_URL,
                        Runbook: frontendRunbookLink()
                    ])
                ])
            }
        }
        always {
            archiveArtifacts(
                artifacts: "deployment-summaries/deployment-summary-frontend-${env.BUILD_NUMBER}.json",
                allowEmptyArchive: true,
                fingerprint: true
            )
            sh '''
                set +e
                rm -f frontend-index.html frontend-app.js frontend-style.css cloudfront-invalidation.json cloudfront-invalidation-id.txt
            '''
        }
    }
}
