# 내일경로 AI 데이터 출처와 산출 방식

이 저장소는 고용노동부 공공데이터 224개 목록을 검토한 뒤, MVP 계산에 직접 필요한 6개 핵심 데이터 묶음을 선별해 사용한다.

원본 엑셀과 CSV 전체는 용량 문제로 GitHub 배포본에 포함하지 않는다. 대신 웹앱에 실제 반영된 산출값은 `public/data/datasets.json`과 `public/data/real_data_summary.json`에 포함한다.

## 데이터 범위

| 항목 | 값 |
| --- | --- |
| 검토 목록 | 고용노동부 공공데이터 224개 목록 |
| 로컬 원천 파일 | 64개 |
| 실제 산출 묶음 | 6개 |
| 노동시장 분석 기간 | 2025-04부터 2026-03까지 최신 12개월 |
| 지역 단위 | 17개 시도 |
| 대표 직무 | 데이터 분석, 사무, 마케팅, 개발, 디자인 |

## 핵심 데이터 묶음

| ID | 데이터 | 사용 목적 |
| --- | --- | --- |
| LOCAL-REGJOB | 지역별 직종별 구인구직취업현황(월) | 지역별, 직무별 구인, 구직, 취업 기준선 산출 |
| LOCAL-WAGEWORK | 워크피디아 맞춤형 임금정보 | 직무별 예상 임금 기준선 산출 |
| LOCAL-NCS | NCS 능력단위 목록 | 희망직무별 요구역량과 스킬갭 산정 |
| LOCAL-TRAIN | 내일배움카드발급현황, 실업자훈련실시현황 | 훈련 접근성과 훈련 경로 효과 보정 |
| LOCAL-COUNSEL | 국민취업지원제도 운영기관 목록 | 상담 경로 접근성 보정 |
| LOCAL-SUBSIDY | 청년일자리도약장려금 사업 운영기관 | 장려금 기업 경로 접근성 보정 |

## 인천 데이터 교체 이력

기존 인천 파일은 대구 파일과 구인, 구직, 취업 합계가 완전히 같아 원자료 중복 가능성이 있었다. 새로 받은 인천 원천 파일을 반영했다.

| 지역 | 사용 파일 | 최신 12개월 구인 | 최신 12개월 구직 | 최신 12개월 취업 |
| --- | --- | ---: | ---: | ---: |
| 대구 | 직종별_구인구직취업현황(월)_1778228955973.xlsx | 222,621 | 721,674 | 212,118 |
| 인천 | 직종별_구인구직취업현황(월)_1778385432120.xlsx | 316,326 | 946,005 | 306,303 |

## 산출 방식 요약

지역별 수요지수는 최신 12개월의 구직자 대비 구인인원과 구직자 대비 취업건수를 함께 반영한다.

```text
openingsPerSeeker = 구인인원 / 구직건수
employmentPerSeeker = 취업건수 / 구직건수
demand = 0.55 * 표준화(openingsPerSeeker) + 0.45 * 표준화(employmentPerSeeker)
competition = 표준화(구직건수 / 구인인원)
```

직무별 지역 통계도 별도로 산출한다. 시뮬레이션은 지역 전체값만 쓰지 않고 `지역 전체 수요 및 경쟁도`와 `해당 지역의 희망직무 수요 및 경쟁도`를 함께 반영한다.

```text
baseDemand = 0.50 * regionDemand + 0.50 * jobRegionDemand
baseCompetition = 0.55 * regionCompetition + 0.45 * jobRegionCompetition
```

## 시뮬레이션

웹앱은 Monte Carlo 기반 개인 ABM 방식으로 경로를 비교한다.

| 항목 | 값 |
| --- | --- |
| 에이전트 수 | 시나리오별 1,000명 |
| 반복 횟수 | 500회 |
| 관찰 기간 | 12개월 |
| 비교 경로 | 바로 구직, 상담, 훈련, 장려금, 통합 |
| 출력 | 취업률, 고용유지율, 평균 취업개월, 예상임금, 이탈률, 종합점수 |

## 주요 산출 파일

| 파일 | 설명 |
| --- | --- |
| `public/data/datasets.json` | 웹앱이 직접 읽는 최종 산출 데이터 |
| `public/data/real_data_summary.json` | 원천 데이터 집계와 검증용 상세 요약 |
| `scripts/build_real_app_data.py` | 원천 데이터를 산출 JSON으로 변환하는 스크립트 |
| `public/app.js` | 경로 추천 시뮬레이션 로직 |
| `server.mjs` | OpenAI API 기반 자연어 프로필 구조화 서버 |

## 공식 출처

- 고용노동부 공공데이터 개방목록: https://www.moel.go.kr/info/publicdata/publicopen/list.do?param=%EA%B3%A0%EC%9A%A9%EB%85%B8%EB%8F%99%EB%B6%80
- EIS 고용행정통계: https://eis.work24.go.kr
- 워크피디아 맞춤형 임금정보: https://www.wagework.go.kr/pt/c/a/retrieveCstmWageSrch.do
- NCS 국가직무능력표준: https://www.ncs.go.kr
- 공공데이터포털 청년일자리도약장려금 운영기관: https://www.data.go.kr/data/15119494/fileData.do
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
