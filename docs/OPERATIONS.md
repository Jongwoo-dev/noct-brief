# 운영·복구 절차

2026-11-21 갱신. 분리 PostgreSQL에서 예약 처리와 백업·복원을 검증했다. Telegram과 외부 저장소 응답은 모의로 시험했다. 서버 구매·계정 변경·실제 배포는 별도 승인 후 진행한다. [기술 설계 12절](TECH_SPEC.md)

## 새 서버 준비

1. 승인된 Ubuntu 24.04 x64 서버에서 `CONFIRM_HOST_SETUP=new-noct-server bash scripts/ops/prepare-host.sh`를 root로 실행한다. PostgreSQL 16, 공식 Node.js 24.14.0, 보안 업데이트 도구, noct 계정과 디렉터리를 준비한다. 자동 재부팅·앱 예약 작업은 활성화하지 않는다. 해당 Linux 스크립트는 아직 실제 서버에서 시험하지 않았다.
2. PostgreSQL을 loopback 전용으로 제한한다. 앱 전용 DB·역할을 만들고 운영 DB 이름과 비밀 값을 설정한다. 불필요한 외부 DB 포트를 열지 않는다. 마이그레이션 역할의 DDL 권한과 일반 실행 권한을 배포 시 구체화한다.
3. Caddy와 AWS CLI는 공식 배포 경로로 설치한다. 도메인·DNS·HTTPS와 방화벽(웹 80/443, 관리자 제한 SSH)을 확인한다. `scripts/ops/Caddyfile`은 localhost:3000으로 프록시한다.
4. `/etc/noct/environment`에 `.env.example`의 운영용 이름을 사용해 값을 등록하고 root:noct, 0640으로 제한한다. APP_ENV=production, DATA_MODE=live, HTTPS BETTER_AUTH_URL을 사용한다. 초기 AUTO_PUBLISH_ENABLED/TELEGRAM_ENABLED/EXTERNAL_CALLS_ENABLED는 false로 유지한다. AWS CLI 자격 증명은 이 파일의 서버 환경 또는 보호된 별도 파일에 공급하고 소스에 넣지 않는다.
5. 외부 수집기·이용권·모델·관리자 검증을 마친 뒤 필요한 기능만 활성화한다. 비밀 값은 argv·journal·진단 화면에 출력하지 않는다.

## 릴리스와 업데이트

Linux 빌드 환경에서 `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run release:package`를 수행한다. 실제 DB 검증은 별도 로컬 테스트 DB에서 수행한다. Windows 산출물은 Linux 배포용이 아니다.

생성된 묶음을 새 `/opt/noct/releases/릴리스명`에 배치하고 해당 디렉터리에서 `npm ci --omit=dev`를 실행한다. 마이그레이션과 백업·복원 스크립트는 tsx를 사용한다. standalone 웹 서버와 별도로 작업 스크립트·마이그레이션·정적 파일이 있어야 한다. 릴리스에는 환경 파일·DB 파일·비밀 자료를 포함하지 않으며 manifest를 확인한다.

최초 운영 마이그레이션은 비밀 환경을 로드한 상태에서 `CONFIRM_PRODUCTION_MIGRATION=production npm run db:migrate`로 실행한다. 기존 운영 DB 변경 시 먼저 외부 백업을 확인하고 되돌릴 수 없는 스키마 변경을 구별한다. 마이그레이션은 체크섬·DB advisory lock으로 중복 실행을 막고 환경·데이터 모드 표식을 확인한다.

`noct-web.service`와 일일 DB 백업용 `noct-backup.service/timer`를 systemd에 설치한다. 환경 경로·Node 경로·파일 소유권을 확인하고 daemon-reload 후 승인된 서비스만 시작한다. `RELEASE=/opt/noct/releases/릴리스명 bash scripts/ops/deploy.sh`는 current 심볼릭 링크를 전환하고 health 실패 시 이전 앱 릴리스를 복구한다. DB 스키마를 자동으로 되돌리지는 않는다. 호환 스키마를 먼저 적용한다. 자동 발행을 중지할 때는 서버 설정의 AUTO_PUBLISH_ENABLED를 false로 바꾸고 웹 프로세스를 재시작한다.

운영 웹 프로세스가 시작되면 Next.js가 발행 작업을 한 번 등록한다. 활성화한 경우 즉시 한 번, 이후 1분마다 DB의 다음 실행 시각을 확인한다. 실행 중인 작업은 90초 lease와 fence를 사용한다. 개발 서버에서는 샘플을 수동으로 시험한다.

보안 패치 자동 적용은 초기 제안이며 설정과 재부팅 시간을 검토한다. Node·앱 의존성·DB 메이저 버전은 릴리스 검사·백업·복원 확인 후 갱신한다. 정규 발행 작업과 겹치는 재부팅을 피한다. 4GB에서의 실제 메모리·빌드 부하·트래픽은 아직 측정하지 않았으므로 서버에서 빌드한다는 전제를 두지 않는다.

## 백업과 복원

백업은 `node --import tsx scripts/ops/backup.ts`가 PostgreSQL custom dump를 만들고 구조 목록·크기를 확인한 뒤 비공개 외부 버킷 `noct-db/`에 암호화 업로드한다. head의 크기·SHA-256 메타데이터를 확인한 후에만 정확한 자체 파일 이름 중 14일을 넘은 백업을 삭제한다. 메타데이터 일치는 원격 파일을 다시 내려받아 검증한 것과 같지 않다. 실제 외부 업로드·다운로드 복원 확인은 운영 준비 때 수행해야 한다.

timer 초기 제안은 매일 UTC 07:00, 최대 2분 분산이다. BACKUP_BUCKET을 정하고 버킷의 공개 접근을 차단한다. 권한은 이 prefix의 PutObject/GetObject/DeleteObject 및 제한된 ListBucket만 부여한다. AWS 자격 증명과 업로드 암호화 옵션의 선택 저장소 호환성은 미검증이다. 서버 전체 스냅샷은 만들지 않는다.

복원은 백업 파일을 내려받고 해시를 확인한 후 **현재 앱 DB와 다른 빈 DB**에서 수행한다. `RESTORE_DATABASE_URL`을 지정하고 `CONFIRM_RESTORE=empty-database node --import tsx scripts/ops/restore.ts 백업파일`을 실행한다. 원자적 pg_restore 후 회차 수·현재 버전 연결·비공개 글 제외·로그인·환경 표식을 확인하고 DB 연결을 전환한다. 로컬 테스트 DB로 운영 사본을 연결해 자동 실행하지 않는다. 새 서버를 준비해 앱·비밀 설정·DB를 복원할 수 있어야 하며 기존 DB 삭제는 별도 작업이다. [PostgreSQL 복원 옵션](https://www.postgresql.org/docs/current/app-pgrestore.html)

백업은 DB 환경·모드 표식을 먼저 검사한다. 업로드 확인과 만료분 정리까지 성공해야 마지막 성공 시각이 갱신된다. 정상 DB에서 발생한 덤프·업로드·정리 실패는 UTC 날짜별로 한 번 알림 대기열에 기록한다. 예약 실행기는 최근 성공 시각부터 26시간이 되면 미갱신 알림을 기록한다. 첫 백업 전에는 감시 시작 시각부터 계산한다. 서버·DB·예약 작업 전체 장애를 감지할 외부 heartbeat는 배포 전 확인 과제다.

복원 대상은 새로 준비하고 전환 전까지 앱과 다른 클라이언트의 접속을 닫아 둔다. 스크립트가 기존 연결·사용자 스키마·객체를 확인하고 복원끼리 겹치지 않도록 잠금을 잡는다. DB 주소의 호스트·포트·DB 이름은 URI 본문에 명시한다. 도구에 전달하는 쿼리 옵션은 `sslmode`, `sslcert`, `sslkey`, `sslrootcert`, `application_name`, `connect_timeout`이다. 로컬 재현은 `npm run db:local` 실행 중 별도 터미널에서 `npm run test:integration`을 사용한다.

## 운영 상태와 복구

예약 처리기가 정상 종료하면 `last_scheduler`에 실행 시작 시각을 기록한다. 중단 후 재실행하면 기존 작업에서 이어가며, 저장된 시각이 없으면 최근 12시간부터 탐색한다. 새로 탐색하는 범위는 최대 31일이다. 발행 예정 시각이 지난 최신 회차만 재개하고 앞선 미발행 회차는 안내로 마감한다. 재시작 당시 이미 알려진 외부 응답 ID는 회수하고 접수 여부가 불명확한 요청은 관리자가 확인한다. 미발행 안내는 같은 점검에서 마감한 건수를 묶어 한 번 알린다. 알림 대기열은 발송 실패 후 1·5·15분에 재시도한다. 네 번째 실패는 관리자 목록의 「예외 알림」에서 발송 실패로 확인한다.

- `/admin`: 회차 상태, 다음 처리, 오류 코드, 누락, 사용량, 정정·재시도·비공개·복구. Google sub 허용 목록과 서버 세션 검사를 적용한다.
- `SUBMISSION_UNKNOWN`: API 접수 여부 불명. 공급자 기록을 확인해 기존 response ID를 회수하거나 미접수임을 확인하기 전 재요청하지 않는다. 무조건 재실행 버튼은 차단한다. 해당 복구 조정은 운영자 확인 후 DB 작업으로 처리하며 자동 추측하지 않는다.
- 자료 부족: 중요 콜은 10분 간격·최대 1시간 대기. 상한 뒤 누락을 밝히고 검증 가능한 내용으로 진행한다. 기술 오류는 1/5/15분 최대 3회 재시도한다. 429 Retry-After가 더 길면 이를 따른다.
- 정정: 문제 항목·이유·근거 URL·기존 버전이 필요하다. 같은 자료 기준 시각의 정정 근거 Bundle을 반입한 뒤 생성한다. 새로 발생한 사건은 다음 회차에 넣는다. 검증 실패 시 기존 버전이 유지되고 비공개 글은 정정으로 자동 공개되지 않는다.
- 달력: `data/calendar.json`의 확인 범위는 2026~2027이다. 범위 밖은 미확인으로 막는다. 임시 휴장 시 공식 NYSE 확인 후 extraClosures를 수정하고 테스트·릴리스를 진행한다. 자동 거래소 휴장 공지 감지는 아직 없다.

실제 자료 묶음 반입은 `node --import tsx scripts/import-bundle.ts YYYY-MM-DD pre|post 파일`을 사용한다. 계약은 `lib/contract.ts`이며 출처·이용권·시각을 검증한다. 현재는 외부 수집기 연결 전의 입력 경계이며 자동 수집을 대신하는 완성 기능으로 소개하지 않는다.
