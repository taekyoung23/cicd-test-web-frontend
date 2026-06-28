def slackDisplay(value) {
    return value == null || value.toString().trim() == '' ? 'N/A' : value.toString()
}

def slackSection(details) {
    if (details instanceof List) {
        return details.collect { value ->
            "- ${slackDisplay(value)}"
        }.join('\n')
    }

    return details.collect { key, value ->
        "- ${key}: ${slackDisplay(value)}"
    }.join('\n')
}

def setDeployPhase(String phase) {
    env.DEPLOY_PHASE = phase
    writeFile(file: '.frontend-deploy-phase', text: phase)
}

def currentDeployPhase() {
    String phase = ''
    if (fileExists('.frontend-deploy-phase')) {
        phase = readFile('.frontend-deploy-phase').trim()
    }
    if (!phase) {
        phase = env.DEPLOY_PHASE ?: 'UNKNOWN'
    }
    return phase == 'PIPELINE_INITIALIZED' ? 'UNKNOWN' : phase
}

def currentInvalidationId() {
    String invalidationId = ''
    invalidationId = env.CLOUDFRONT_INVALIDATION_ID ?: ''
    if (!invalidationId || ['N/A', 'None', 'null'].contains(invalidationId)) {
        if (fileExists('cloudfront-invalidation-id.txt')) {
            invalidationId = readFile('cloudfront-invalidation-id.txt').trim()
        }
    }
    return invalidationId in ['', 'N/A', 'None', 'null'] ? 'N/A' : invalidationId
}

def isMissingValue(value) {
    String normalized = value == null ? '' : value.toString().trim()
    return normalized in ['', 'N/A', 'None', 'null']
}

def initializeFrontendRollbackState() {
    env.FRONTEND_DEPLOY_STARTED = 'false'
    env.FRONTEND_BASELINE_CAPTURED = 'false'
    env.FRONTEND_ROLLBACK_REQUIRED = 'false'
    env.FRONTEND_ROLLBACK_EXECUTED = 'false'
    env.FRONTEND_ROLLBACK_RESULT = 'NOT_REQUIRED'
    env.FRONTEND_ROLLBACK_TRIGGER = 'N/A'
    env.FRONTEND_ROLLBACK_INVALIDATION_ID = 'N/A'
    env.POST_ROLLBACK_VERIFICATION_RESULT = 'NOT_RUN'
    env.BASELINE_INDEX_VERSION_ID = 'N/A'
    env.BASELINE_APP_VERSION_ID = 'N/A'
    env.BASELINE_STYLE_VERSION_ID = 'N/A'
}

def captureS3BaselineVersions() {
    Map files = [
        'index.html': 'BASELINE_INDEX_VERSION_ID',
        'app.js'    : 'BASELINE_APP_VERSION_ID',
        'style.css' : 'BASELINE_STYLE_VERSION_ID'
    ]

    files.each { key, envName ->
        String versionId = sh(
            returnStdout: true,
            script: """
                set -eu
                aws s3api list-object-versions \\
                  --bucket '${env.S3_BUCKET}' \\
                  --prefix '${key}' \\
                  --query "Versions[?IsLatest && Key=='${key}'].VersionId | [0]" \\
                  --output text
            """
        ).trim()

        if (isMissingValue(versionId)) {
            error("Could not capture baseline S3 VersionId for ${key}.")
        }

        if (envName == 'BASELINE_INDEX_VERSION_ID') {
            env.BASELINE_INDEX_VERSION_ID = versionId
        } else if (envName == 'BASELINE_APP_VERSION_ID') {
            env.BASELINE_APP_VERSION_ID = versionId
        } else if (envName == 'BASELINE_STYLE_VERSION_ID') {
            env.BASELINE_STYLE_VERSION_ID = versionId
        } else {
            error("Unsupported baseline env name: ${envName}")
        }
        echo "Captured S3 baseline VersionId for ${key}: ${versionId}"
    }

    env.FRONTEND_BASELINE_CAPTURED = 'true'
    writeFile(
        file: 'frontend-s3-baseline-versions.json',
        text: """{
  "index.html": "${env.BASELINE_INDEX_VERSION_ID}",
  "app.js": "${env.BASELINE_APP_VERSION_ID}",
  "style.css": "${env.BASELINE_STYLE_VERSION_ID}"
}
"""
    )
}

def restoreS3BaselineVersions() {
    Map files = [
        'index.html': env.BASELINE_INDEX_VERSION_ID,
        'app.js'    : env.BASELINE_APP_VERSION_ID,
        'style.css' : env.BASELINE_STYLE_VERSION_ID
    ]

    files.each { key, versionId ->
        if (isMissingValue(versionId)) {
            error("Missing baseline S3 VersionId for ${key}.")
        }

        sh """
            set -eu
            ENCODED_VERSION_ID="\$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' '${versionId}')"
            COPY_SOURCE="${env.S3_BUCKET}/${key}?versionId=\${ENCODED_VERSION_ID}"
            aws s3api copy-object \\
              --bucket '${env.S3_BUCKET}' \\
              --copy-source "\${COPY_SOURCE}" \\
              --key '${key}' \\
              --metadata-directive COPY >/dev/null
            echo "Restored ${key} from baseline VersionId ${versionId}"
        """
    }
}

def createFrontendRollbackInvalidation() {
    String invalidationId = sh(
        returnStdout: true,
        script: '''
            set -eu
            rm -f cloudfront-rollback-invalidation-id.txt

            aws cloudfront create-invalidation \
              --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
              --paths "/" "/index.html" "/app.js" "/style.css" \
              --query 'Invalidation.Id' \
              --output text > cloudfront-rollback-invalidation-id.txt

            INVALIDATION_ID="$(tr -d '\\r\\n\\t ' < cloudfront-rollback-invalidation-id.txt)"
            printf '%s' "${INVALIDATION_ID}" > cloudfront-rollback-invalidation-id.txt

            if [ -z "${INVALIDATION_ID}" ] || [ "${INVALIDATION_ID}" = "N/A" ] || [ "${INVALIDATION_ID}" = "None" ] || [ "${INVALIDATION_ID}" = "null" ]; then
              echo "Rollback CloudFront invalidation ID was not returned." >&2
              exit 1
            fi

            echo "Parsed rollback CloudFront invalidation ID: ${INVALIDATION_ID}" >&2

            timeout 10m aws cloudfront wait invalidation-completed \
              --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
              --id "${INVALIDATION_ID}"

            echo "Rollback CloudFront invalidation completed: ${INVALIDATION_ID}" >&2
            printf '%s' "${INVALIDATION_ID}"
        '''
    ).trim()

    if (isMissingValue(invalidationId)) {
        error('Rollback CloudFront invalidation ID was not returned.')
    }

    env.FRONTEND_ROLLBACK_INVALIDATION_ID = invalidationId
    writeFile(file: 'cloudfront-rollback-invalidation-id.txt', text: invalidationId)
    return invalidationId
}

def verifyFrontendRollback() {
    int status = sh(
        returnStatus: true,
        script: '''
            set +e

            for attempt in 1 2 3 4 5; do
              echo "Frontend post-rollback verification attempt ${attempt}/5"
              rm -f frontend-rollback-index.html frontend-rollback-app.js frontend-rollback-style.css

              if curl --fail --silent --show-error --location "${FRONTEND_URL}/" -o frontend-rollback-index.html && \
                 grep -q 'SecureVoiceGuard' frontend-rollback-index.html && \
                 curl --fail --silent --show-error --location "${FRONTEND_URL}/app.js" -o frontend-rollback-app.js && \
                 curl --fail --silent --show-error --location "${FRONTEND_URL}/style.css" -o frontend-rollback-style.css; then
                echo "Frontend post-rollback verification passed."
                exit 0
              fi

              if [ "${attempt}" -lt 5 ]; then
                sleep 10
              fi
            done

            echo "Frontend post-rollback verification failed."
            exit 1
        '''
    )

    if (status == 0) {
        env.POST_ROLLBACK_VERIFICATION_RESULT = 'PASSED'
        env.FRONTEND_ROLLBACK_RESULT = 'RECOVERY_VERIFIED'
    } else {
        env.POST_ROLLBACK_VERIFICATION_RESULT = 'FAILED'
        env.FRONTEND_ROLLBACK_RESULT = 'ROLLBACK_VERIFICATION_FAILED'
    }

    return status == 0
}

def performFrontendRollbackIfNeeded() {
    if (env.FRONTEND_ROLLBACK_EXECUTED == 'true') {
        return
    }

    if (env.FRONTEND_DEPLOY_STARTED != 'true' || env.FRONTEND_BASELINE_CAPTURED != 'true') {
        env.FRONTEND_ROLLBACK_REQUIRED = 'false'
        env.FRONTEND_ROLLBACK_RESULT = 'NOT_REQUIRED'
        echo 'Frontend rollback is not required because deployment did not modify S3 objects or baseline was not captured.'
        return
    }

    env.FRONTEND_ROLLBACK_REQUIRED = 'true'
    env.FRONTEND_ROLLBACK_TRIGGER = currentDeployPhase()
    env.FRONTEND_ROLLBACK_EXECUTED = 'true'
    env.FRONTEND_ROLLBACK_RESULT = 'IN_PROGRESS'

    try {
        restoreS3BaselineVersions()
        createFrontendRollbackInvalidation()
        verifyFrontendRollback()
    } catch (Exception rollbackError) {
        env.FRONTEND_ROLLBACK_RESULT = 'ROLLBACK_FAILED'
        env.POST_ROLLBACK_VERIFICATION_RESULT = env.POST_ROLLBACK_VERIFICATION_RESULT ?: 'NOT_RUN'
        echo "Frontend rollback failed: ${rollbackError.getMessage()}"
    }
}

def sendFrontendRollbackSlack() {
    if (env.FRONTEND_ROLLBACK_EXECUTED != 'true') {
        return
    }

    sendSlackNotification(':warning: Frontend Rollback 결과 - S3 baseline 복구', [
        '복구 결과': slackSection([
            Result             : env.FRONTEND_ROLLBACK_RESULT,
            Trigger            : env.FRONTEND_ROLLBACK_TRIGGER ?: currentDeployPhase(),
            'Baseline Restored': env.FRONTEND_ROLLBACK_RESULT == 'RECOVERY_VERIFIED' ? 'Yes' : 'Check required'
        ]),
        '복원 파일': slackSection([
            'index.html': env.FRONTEND_ROLLBACK_RESULT == 'RECOVERY_VERIFIED' ? 'restored' : 'check required',
            'app.js'    : env.FRONTEND_ROLLBACK_RESULT == 'RECOVERY_VERIFIED' ? 'restored' : 'check required',
            'style.css' : env.FRONTEND_ROLLBACK_RESULT == 'RECOVERY_VERIFIED' ? 'restored' : 'check required'
        ]),
        'CloudFront': slackSection([
            'Rollback Invalidation': env.FRONTEND_ROLLBACK_INVALIDATION_ID
        ]),
        '검증': slackSection([
            Domain         : env.FRONTEND_URL,
            'HTTP Status'  : env.POST_ROLLBACK_VERIFICATION_RESULT == 'PASSED' ? '200' : 'Check required',
            'Content Check': env.POST_ROLLBACK_VERIFICATION_RESULT == 'PASSED' ? 'SecureVoiceGuard OK' : 'Check required',
            Assets         : env.POST_ROLLBACK_VERIFICATION_RESULT == 'PASSED' ? 'app.js/style.css OK' : 'Check required'
        ]),
        '링크': slackSection([
            Jenkins: env.BUILD_URL,
            Runbook: frontendRunbookLink()
        ])
    ])
}

def frontendRunbookLink() {
    return '<https://github.com/taekyoung23/cicd-test-web-frontend/blob/ktk-cicd/docs/runbooks/frontend-deployment-runbook.md|운영 가이드>'
}

def sendSlackNotification(String title, Map details) {
    String messageFile = ".slack-message-${env.BUILD_NUMBER ?: 'unknown'}.txt"
    String payloadFile = ".slack-payload-${env.BUILD_NUMBER ?: 'unknown'}.json"
    try {
        String body = ([title] + details.collect { key, value ->
            "*${key}:*\n${slackDisplay(value)}"
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

def invalidation_id():
    env_result = value("CLOUDFRONT_INVALIDATION_ID")
    if env_result not in ("", "N/A", "None", "null"):
        return env_result
    try:
        with open("cloudfront-invalidation-id.txt", "r", encoding="utf-8") as id_file:
            file_result = id_file.read().strip()
            return file_result if file_result else "N/A"
    except FileNotFoundError:
        return "N/A"

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
    "invalidation_id": invalidation_id(),
    "domain": value("FRONTEND_URL"),
    "verification_result": value("VERIFICATION_RESULT"),
    "rollback_required": value("FRONTEND_ROLLBACK_REQUIRED"),
    "rollback_executed": value("FRONTEND_ROLLBACK_EXECUTED"),
    "rollback_result": value("FRONTEND_ROLLBACK_RESULT"),
    "rollback_trigger": value("FRONTEND_ROLLBACK_TRIGGER"),
    "baseline_versions": {
        "index.html": value("BASELINE_INDEX_VERSION_ID"),
        "app.js": value("BASELINE_APP_VERSION_ID"),
        "style.css": value("BASELINE_STYLE_VERSION_ID"),
    },
    "rollback_invalidation_id": value("FRONTEND_ROLLBACK_INVALIDATION_ID"),
    "post_rollback_verification": value("POST_ROLLBACK_VERIFICATION_RESULT"),
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

    parameters {
        booleanParam(
            name: 'FORCE_FRONTEND_VERIFY_FAIL',
            defaultValue: false,
            description: 'Force post-deploy verification failure after S3 upload and CloudFront invalidation to test S3 versioning rollback.'
        )
    }

    environment {
        AWS_REGION = 'ap-northeast-2'
        REPOSITORY_NAME = 'cicd-test-web-frontend'
        TARGET_BRANCH = 'ktk-cicd'
        S3_BUCKET = 'mzc-securevoiceguard-web-dev'
        CLOUDFRONT_DISTRIBUTION_ID = 'E2ZAHL4TTM1M8O'
        FRONTEND_URL = 'https://mzmt.shop'
        DEPLOYMENT_SUMMARY_DIR = 'deployment-summaries'
    }

    stages {
        stage('Source Checkout') {
            steps {
                script {
                    initializeFrontendRollbackState()
                    setDeployPhase('SOURCE_CHECKOUT')
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
                    setDeployPhase('STATIC_FILE_VALIDATION')
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
                    setDeployPhase('S3_UPLOAD')
                    captureS3BaselineVersions()
                    env.FRONTEND_DEPLOY_STARTED = 'true'
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
                    setDeployPhase('CLOUDFRONT_INVALIDATION')
                }
                script {
                    String invalidationId = sh(
                        returnStdout: true,
                        script: '''
                            set -eu
                            rm -f cloudfront-invalidation.json cloudfront-invalidation-id.txt

                            aws cloudfront create-invalidation \
                              --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
                              --paths "/" "/index.html" "/app.js" "/style.css" \
                              --query 'Invalidation.Id' \
                              --output text > cloudfront-invalidation-id.txt

                            INVALIDATION_ID="$(tr -d '\\r\\n\\t ' < cloudfront-invalidation-id.txt)"
                            printf '%s' "${INVALIDATION_ID}" > cloudfront-invalidation-id.txt

                            if [ -z "${INVALIDATION_ID}" ] || [ "${INVALIDATION_ID}" = "N/A" ] || [ "${INVALIDATION_ID}" = "None" ] || [ "${INVALIDATION_ID}" = "null" ]; then
                              echo "CloudFront invalidation ID was not returned." >&2
                              exit 1
                            fi

                            echo "Parsed CloudFront invalidation ID: ${INVALIDATION_ID}" >&2

                            timeout 10m aws cloudfront wait invalidation-completed \
                              --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
                              --id "${INVALIDATION_ID}"

                            echo "CloudFront invalidation completed: ${INVALIDATION_ID}" >&2
                            printf '%s' "${INVALIDATION_ID}"
                        '''
                    ).trim()
                    env.CLOUDFRONT_INVALIDATION_ID = invalidationId ?: 'N/A'
                    writeFile(file: 'cloudfront-invalidation-id.txt', text: env.CLOUDFRONT_INVALIDATION_ID)
                    echo "CloudFront invalidation ID: ${currentInvalidationId()}"
                }
            }
        }

        stage('Post-Deploy Verification') {
            steps {
                script {
                    setDeployPhase('POST_DEPLOY_VERIFICATION')
                    if (params.FORCE_FRONTEND_VERIFY_FAIL) {
                        error('Forced frontend post-deploy verification failure for S3 versioning rollback test.')
                    }
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
                    setDeployPhase('DEPLOY_SUCCESS')
                    env.SUMMARY_BUILD_RESULT = 'SUCCESS'
                    env.CLOUDFRONT_INVALIDATION_ID = currentInvalidationId()
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
                        Result: 'SUCCESS'
                    ]),
                    '배포 정보': slackSection([
                        Repo        : env.REPOSITORY_NAME,
                        Branch      : env.GIT_BRANCH_NAME,
                        Commit      : env.GIT_SHORT_SHA,
                        'S3 Bucket' : env.S3_BUCKET,
                        CloudFront  : env.CLOUDFRONT_DISTRIBUTION_ID,
                        Invalidation: currentInvalidationId()
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
                if (!env.VERIFICATION_RESULT || env.VERIFICATION_RESULT == 'NOT_RUN') {
                    env.VERIFICATION_RESULT = 'FAILED'
                }
                env.CLOUDFRONT_INVALIDATION_ID = currentInvalidationId()
                performFrontendRollbackIfNeeded()
                writeFrontendSummary(env.SUMMARY_BUILD_RESULT)
                sendSlackNotification(':x: Frontend 배포 실패', [
                    '핵심 상태': slackSection([
                        Build              : "#${env.BUILD_NUMBER}",
                        Result             : 'FAILED',
                        'Failed Stage'     : currentDeployPhase(),
                        'Rollback Required': env.FRONTEND_ROLLBACK_REQUIRED ?: 'false',
                        'Rollback Executed': env.FRONTEND_ROLLBACK_EXECUTED ?: 'false',
                        'Rollback Result'  : env.FRONTEND_ROLLBACK_RESULT ?: 'N/A'
                    ]),
                    '배포 정보': slackSection([
                        Repo        : env.REPOSITORY_NAME,
                        Branch      : env.GIT_BRANCH_NAME ?: env.TARGET_BRANCH,
                        Commit      : env.GIT_SHORT_SHA ?: 'N/A',
                        'S3 Bucket' : env.S3_BUCKET,
                        CloudFront  : env.CLOUDFRONT_DISTRIBUTION_ID
                    ]),
                    '다음 확인': slackSection([
                        'Jenkins Console Log',
                        'S3 업로드 결과',
                        'CloudFront Invalidation 상태',
                        'Rollback Result Slack',
                        'S3 Object Version',
                        "${env.FRONTEND_URL} 응답",
                        'CloudFront 캐시 반영 여부'
                    ]),
                    '링크': slackSection([
                        Jenkins: env.BUILD_URL,
                        Runbook: frontendRunbookLink()
                    ])
                ])
                sendFrontendRollbackSlack()
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
                rm -f frontend-index.html frontend-app.js frontend-style.css
                rm -f frontend-rollback-index.html frontend-rollback-app.js frontend-rollback-style.css
                rm -f cloudfront-invalidation.json cloudfront-invalidation-id.txt cloudfront-rollback-invalidation-id.txt
                rm -f frontend-s3-baseline-versions.json .frontend-deploy-phase
            '''
        }
    }
}
