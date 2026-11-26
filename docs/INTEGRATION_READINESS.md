# 외부 연동 준비

2026-11-24 Sol 6.1·Sol 6.2·Astra 6 기사형 비교와 근거 검증 상태 갱신. 첫 비공개 회차 작성과 텔레그램 실수신을 확인했다. 현재 [정규 리포트 발행 로드맵](TECH_SPEC.md#정규-리포트-발행-로드맵)에 따라 무료·개인용 API와 웹 원문을 활용해 장후 결과와 예정 이벤트 안내를 합친 콘텐츠를 먼저 완성한다.

같은 날 후속 결정으로 KST와 원본 시각을 함께 표시하고 원본 시간대가 없으면 UTC를 사용한다. 새 `kst-original-v1` 규칙은 원문 시간 메타·근거별 코드 계산값·시각 쌍 검사를 포함하며 기존 API 시험과 분리한다. 구조화되지 않은 본문 사건·관측 시각은 입력 준비 때 직접 확인해야 한다. 2026-11-26 사용자는 코덱스 통합 원고의 구성을 이번 시험 기준으로 채택하고 무료 사전검사 후 Astra 6 생성·Sol 6.2 검증 결과를 보고 조정하기로 했다. 편집 기준의 최종 품질 판단과 운영 배포는 별도다. [시간 계약·검증 경계](TECH_SPEC.md#한국시간-표시와-서머타임-변환--2026-11-24-사용자-확정).

| 항목 | 현재 구현과 막힌 지점 | 추천 및 필요한 결정 |
| --- | --- | --- |
| 시장 데이터 | 공급원 독립 Bundle 검사·반입·저장을 구현했다. | 품질 점검에는 시각이 기록된 당일 마감 기사·공식 발표와 무료 API를 사용한다. 접근이 어려운 항목은 다른 원문을 찾고, 본문에는 실제로 확인한 값만 쓴다. |
| 뉴스·공식 발표·콜 조사 | 출처·시간·사건·근거 발췌 저장과 생성 입력은 구현. 자동 웹 조사·원문 정규화는 미연결 | 연준·BLS·BEA·SEC/기업 IR을 기본 출발점으로 재사용하고 사건별 검색으로 확장. 확인한 수집 형식·출처 교체·캐시 기준은 TECH_SPEC 3절 |
| AI 생성 | Responses API background·구조화 응답·회수·사용량 저장·1회 보정·축소본 구현. 실제 Sol·Astra 응답과 사용량 확인 | 생성 `OPENAI_MODEL=gpt-6-astra`·검증 `OPENAI_VERIFICATION_MODEL=gpt-6.2-sol`을 사용한다. 2026-11-26 v1은 시간 병기 검사에서 중단됐지만 후속 승인된 v2는 문체·예정 목록 기준과 출력 상한 10,000을 적용해 1회 보정 후 근거 재검증 34항목을 통과했다. 일부 문체·목록은 개선됐으나 PMI 설명과 한계 반복은 남았고, 읽기 HTML의 실화면 검사는 브라우저 접근 제한으로 미확인이다. 상세 결과는 TECH_SPEC 12절, 모델 분리는 5절, 비용·승인 범위는 8절을 따른다. 추가 유료 시험·운영 배포는 별도 승인이다. |
| 생성 후 검증 | 비공개 시험에 기계 검사·별도 AI의 주장별 근거 대조·1회 보정 후 재검사를 연결. 11월 20일 장후 Sol 6.1·Astra 6은 각각 31개, Sol 6.2는 25개 항목에서 지지 판정 확인 | 한국어 12시간제와 출처의 24시간제 대조 오탐을 수정했다. 검증 항목 수와 지지 판정을 글의 품질 점수로 사용하지 않으며 표현 범위·발췌가 뒷받침하는 세부 내용은 직접 대조한다. TECH_SPEC 5·12절. 검증 비용도 승인된 시험 금액 안에 합산 |
| 관리자 | 관리·더미 테스트 구현, DB 통합 검사 완료. 전용 로컬 Google 로그인·sub 등록·로그아웃/재로그인과 인증된 더미 발행·정정·실패 재시도·비공개/복구·버전 조회 확인. 인증된 390px 목록·알림·상세·이전 버전 조회 확인 | 로컬 관리 흐름 검증 완료. 다른 실제 계정 거부·운영 OAuth는 미검증. 운영 계정 설정 변경은 별도 승인 필요. 검증 범위는 TECH_SPEC 12절 |
| 알림 | 미발행 회차 묶음 알림, 운영 코드에서 지연 감지·중복 억제·모의 발송 재시도·최종 실패 표시 검증 | 운영자 개인 대화로 시험 메시지 한 건 수신 확인. 운영 서버 설정 후 실제 장애 알림 경로 검증 |
| 서버 | 4GB 자체 서버·Node.js·동일 서버 PostgreSQL 확정. 실행·배포 스크립트 준비 | AWS Lightsail Ubuntu 24.04 x64를 초기 후보로 제안. 리전·도메인·인스턴스 구매·DNS·HTTPS·공개 시점은 별도 결정 |
| 백업 | 하루 1회·14일 보관 확정. 운영 백업 코드의 모의 업로드·만료 정리·실패 처리와 실제 덤프의 분리 DB 복원 검증 | AWS S3 API 호환 비공개 버킷을 제안. UTC 07:00(KST 16:00)은 초기 실행 시각 제안. 저장소 요금·접근 권한·업로드/복원 검증 후 일일 timer와 `AUTO_BACKUP_ENABLED` 활성화 |

## 정규 발행 데이터 조사

무료·개인용 API와 시각이 명시된 웹 원문을 우선한다. SEC 공시·BLS의 발표 일정과 보관본으로 경제·기업 자료를 확인하고, 시세·업종은 날짜별 보도를 교차 확인한다. 조회 중 수정되는 페이지는 원래 게시 시각만으로 채택하지 않는다. 아래 표는 공개 운영을 검토할 때 참고할 공급자별 조건이다. [SEC 공개 API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) · [BLS API](https://www.bls.gov/developers/api_faqs.htm) · [BLS 발표 일정](https://www.bls.gov/schedule/2026/home.htm)

| 회차에 필요한 자료 | 마감에 맞는지 | 공개 발행 판단과 근거 |
| --- | --- | --- |
| 장후 S&P 500·다우 산업평균의 실제 종가와 일별 추이 | 11월 20일 다우의 FRED 페이지에는 당일 관측치 업데이트가 18:01 CST(19:01 ET)로 표시됐다. 두 지수 전체에 대한 제공 보장은 아니다. | 두 FRED 계열 모두 원권리자의 재사용 조건이 있다. S&P DJI는 웹사이트 데이터의 공개·파생·저장에 사전 동의를 요구한다. 직접 라이선스 또는 해당 권리를 포함한 공급원을 확인한다. [다우 관측·업데이트](https://fred.stlouisfed.org/series/DJIA) · [S&P 500 계열](https://fred.stlouisfed.org/series/SP500) · [S&P DJI 원문 약관](https://www.spglobal.com/spdji/en/documents/legal/dow-jones-indexes-terms-conditions.pdf) |
| 장후 나스닥 종합지수의 실제 종가와 추이 | 공식 GIDS의 종가 데이터 이용 시각은 18:30 ET로 목표보다 한 시간 이르다. | 유료이며 외부 표시 용도는 주문 조건 확인이 필요하다. 정책 4절에는 종가로 계산한 성과만 배포하는 일부 가입자의 계약 예외가 있다. 종가 자체와 일별 차트를 게시할 수 있는지 5.2·5.4절을 함께 대조한다. [Nasdaq 지수 데이터 정책](https://assets.ctfassets.net/mx0rke14e5yt/6HcbUEVbkBsdmwwe4ekxgV/67a77206836f5005e609ecec4e05103f/Nasdaq_Global_Index_Data_Policies_08032026_Updates.pdf) |
| 장후 업종별 등락 | FMP는 거래소별 업종 평균을 한 시간 주기로 갱신한다. 대안인 Tiingo 미국 주식·ETF 일봉은 17:30 EST 갱신, 20:00 EST까지 사후 수정될 수 있다고 안내한다. | FMP를 쓰면 거래소·모집단·평균 기준을 표시한다. ETF 방식은 State Street의 11개 업종 ETF 정규장 종가를 전 거래일과 비교하고 그래프에 ‘업종 ETF 등락률’로 표시하는 후보안이다. 양쪽 모두 해당 공개 권한 및 19:30 당시 판본 보존을 확인한 뒤 채택한다. [FMP 업종 응답](https://site.financialmodelingprep.com/developer/docs/stable/sector-performance-snapshot) · [갱신 주기](https://site.financialmodelingprep.com/developer/docs/cycle-times-stable) · [11개 ETF](https://www.ssga.com/us/en/individual/capabilities/equities/sector-investing/select-sector-etfs) · [Tiingo 제공 시각·표시 상품](https://www.tiingo.com/products/end-of-day-stock-price-data) |
| 장전 주가지수 선물·장후 개별주 시간외 반응 | CME 공개 웹용 지연 상품은 매시 05분 최종 체결가를 10분 이상 지연해 표시하는 방식을 정한다. Tiingo는 주중 24시간 주식 가격 상품을 제공한다. | 선물은 대상 계약월·관측 시각·공개 웹 패키지 요금을 확인한다. 개별주는 공급 가격이 체결가인지 산출 가격인지 확인해 정규장 종가와 비교한다. 두 상품의 공개 사이트·아카이브·AI 처리 조건은 미확정이다. [CME 웹 표시 조건](https://www.cmegroup.com/market-data/files/schedule-5-to-the-ila-june-2026.pdf) · [Tiingo 피드 설명](https://www.tiingo.com/documentation/websockets/iex) |
| 장전 경제 일정·장후 발표와 금리 | BLS·BEA·연준 이사회는 발표 일정과 해당 회차까지 공개된 원문을 사용한다. 미 재무부 일별 금리는 통상 18:00 ET까지 게시되지만 지연될 수 있다. | BLS·BEA·연준 자체 발표는 각 기관의 예외 표시를 확인하고 출처를 붙여 수집 개발에 쓸 수 있다. 재무부 금리는 관측 시각과 실제 공개 판본을 각각 기록한다. [BLS 이용 조건](https://www.bls.gov/bls/linksite.htm) · [BEA 이용 조건](https://www.bea.gov/help/faq/145) · [연준 이사회 이용 조건](https://www.federalreserve.gov/disclaimer.htm) · [재무부 공개 시각](https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology) |
| 기업 실적·주요 콜 | SEC의 키 없는 submissions API는 공시 배포 중 갱신된다. 회차에 포함할 때는 개별 등록본의 접수 시각·첨부 문서를 확인한다. 기업 IR 콜은 실제 발표·공개 시각을 따른다. | 이미 확인한 실적 수치·공시 링크를 먼저 연결할 수 있다. 기업 작성 자료의 전문과 제3자 콜 녹취의 저장·재배포 범위는 해당 공급자 조건을 따른다. [SEC API 안내](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) · [첫 회차에서 확인한 공시 등록본](https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/0001045810-26-000088-index.htm) |

**후보에서 가려낸 용도.** Twelve Data의 미국 주식 통합 일봉은 다음 거래일 00:00 ET 이후 제공되어 같은 날 19:30 장후판에 늦다. 과거 비교나 별도 실시간 상품은 따로 평가할 수 있다. TradingView는 무료 위젯을 제공하지만 위젯 데이터 내보내기를 지원하지 않아 회차별 작성·검증과 고정된 차트 원자료를 공급하는 용도로 선정하지 않았다. [Twelve Data 미국 주식 안내](https://support.twelvedata.com/en/articles/9935903-us-equities-market-data) · [TradingView 위젯 데이터 FAQ](https://www.tradingview.com/widget-docs/faq/data/)

**현재 선택.** 견적 문의와 업체 계약을 이번 작업에서 제외했다. 정해진 시각에 발표된 원문을 직접 찾거나 셀프서비스 API를 쓴다. 사례로 11월 20일 Reuters 장전판에서 04:57 ET 선물 관측값을, AP 장 마감판에서 당일 세 지수 종가를 확인했다. Nasdaq 100 선물과 나스닥 종합지수는 다른 지표로 표시한다. [Reuters 장전판](https://www.investing.com/news/economy-news/wall-st-futures-slip-as-anthropic-debut-fails-to-reassure-ai-investors-5041171) · [AP 마감판](https://apnews.com/article/c10b797a17c2acf37924d834efebe135)

## 공개 시 사용할 데이터 점검 항목

1. 로그인 없는 공개 사이트의 시세·차트·변동률·파생 지표 재표시 권한. 지수와 ETF 대체값을 구별하고 실제 지수 이용권 포함 여부 확인.
2. 일별 지수·섹터, 장전 선물/해외 흐름, 경제 일정·결과, 기업 실적·콜 전문의 범위, 지연, 갱신 시각, 수정 이력.
3. 원문 발췌·저장·백업·정정 이력 보존의 허용 범위와 기간. 공급 계약 종료 후 보관·공개 정책.
4. 방문자 제한·필수 출처 문구·캐시·월 호출량·초과 요금·서버/개발 키 분리.
5. 한국어 AI 요약·추론·차트 생성에 입력 가능한지와 공개 파생 콘텐츠 조건.

FMP의 일반 가격표는 개인 사용과 별도로 표시·재배포 계약을 요구한다. 개인용 상위 요금제를 구매하면 공개 권한까지 생긴다고 판단하지 않는다. Twelve Data도 Business의 외부 표시 조건과 데이터별 권리를 확인해야 한다. 업체 문의는 발송하지 않았다. [FMP 가격·표시 계약](https://site.financialmodelingprep.com/developer/docs/pricing), [Twelve Data Business](https://twelvedata.com/pricing-business)

## 비공개 품질 점검과 이후 연결 순서

첫 로컬 비공개 회차의 자료를 준비하고 비용 예약과 근거 검사를 연결했다. 정규 발행의 직접 시세 수집과 운영 연동은 별도 단계다.

1. 코딩과 무료 검증을 먼저 마친 뒤 한 거래일의 장후 결과와 다음 거래일 장중까지의 예정 안내를 Codex 기준 원고로 작성한다. 당시 공개된 근거를 쓰고 지수·업종·이벤트·시각 자료의 빈틈을 점검한다.
2. 첫 시험용 비용 집계·중복 방지·차단을 로컬 모의 응답으로 검증한다. 현재 완료된 보호와 미구현 보호는 TECH_SPEC 8·12절에서 구분한다.
3. 기준 원고 작성 다음 단계에서 사용자와 원고를 조정한다. 조정 완료 후 별도 단계에서 생성 Astra 6·검증 Sol 6.2로 비공개 API 결과를 만들고 비교한다. 기존 시험 금액 수락을 이번 단계의 새 유료 호출 승인으로 확대하지 않는다. 실제 수치를 가상 샘플에 섞거나 공개 이용 조건을 통과하지 않은 자료를 공개하지 않는다. 생성 후 첨부 근거 대조를 포함해 기준 시각·수치·주요 사건 누락·사실/해석·읽을 가치·전체 시간·실제 비용을 확인한다.
4. 통합 보고서의 품질을 완성한 뒤 반복 수집과 장후 정규 예약 발행·별도 AI 검증에 연결한다. 운영 공개·배포는 기존 승인 범위를 따른다.

현재 수동 Bundle 반입 경계를 자동 수집 완료로 보지 않는다. 시장 데이터 업체에 보낼 문의는 아직 발송하지 않았으며, 핵심 확인 항목은 위 목록을 사용한다. FMP의 표시 계약 요구와 Twelve Data의 외부 표시/분배 구분은 2026-11-17 공식 페이지에서 재확인했고 실제 프로젝트 견적은 없다.

생성은 `background: true`, `store: true`로 응답 ID를 보존하고 다음 작업에서 회수한다. 계정의 데이터 보관 정책과 호환성을 확인해야 한다. POST 응답이 불명확하면 자동 재요청을 중단한다. 관리자도 단순 재시도로 중복 과금을 일으킬 수 없으며 공급자 기록 확인 후 복구한다. [Background mode](https://developers.openai.com/api/docs/guides/background), [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6.2 Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)

비용 가정·산식은 [기술 명세 8절](TECH_SPEC.md#8-비용-예시와-남은-견적)에서 관리한다. 데이터 계약 견적이 없으므로 총 운영비 확정이나 무료 운영을 약속하지 않는다. 키는 대화·문서에 전달하지 않고 승인된 환경의 비밀 설정에 등록한다.
