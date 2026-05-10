import json
import os
import time
from pathlib import Path

import requests


BASE = "https://www.wagework.go.kr"
OUT = Path("outputs/wagework")
OUT.mkdir(parents=True, exist_ok=True)


def session():
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": f"{BASE}/pt/c/a/retrieveCstmWageSrch.do",
            "X-Requested-With": "XMLHttpRequest",
        }
    )
    s.get(f"{BASE}/pt/c/a/retrieveCstmWageSrch.do", verify=False, timeout=30)
    return s


def post_json(s, path, data=None):
    r = s.post(f"{BASE}{path}", data=data or {}, verify=False, timeout=30)
    r.raise_for_status()
    return r.json()


def load_occupations(s):
    obj = post_json(s, "/pt/c/a/retrieveWageOccpListData.do")
    (OUT / "wagework_occupation_codes_raw.json").write_text(
        json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return obj["data"]


def matches(occupations, terms):
    rows = []
    for item in occupations:
        name = item.get("occpCfnm") or ""
        if any(term in name for term in terms):
            rows.append(
                {
                    "occpClCd": item.get("occpClCd"),
                    "occpCfnm": name,
                    "upprCdId": item.get("upprCdId"),
                    "strfLvlSn": item.get("strfLvlSn"),
                }
            )
    return rows


def hierarchy(row):
    code = str(row["occpClCd"])
    level = str(row["strfLvlSn"])
    parent = str(row.get("upprCdId") or "")
    if level == "1":
        return code, "", ""
    if level == "2":
        return parent, code, ""
    if level == "3":
        return parent[:1], parent, code
    raise ValueError(row)


def result_for_occupation(s, row):
    lr, mid, small = hierarchy(row)
    data = {
        "topPageId": "PT07000000",
        "pageId": "PT07010000",
        "srchCu": "1",
        "searchUseYn": "N",
        "pStrfLvlSn": row["strfLvlSn"],
        "pViewFlag": "S",
        "pOccpClCd": row["occpClCd"],
        "selectOccpClCd": row["occpClCd"],
        "occpLrclCd": lr,
        "occpMlsfCd": mid,
        "occpSclaCd": small,
        "initOccpLrclCdAll": "Y" if row["strfLvlSn"] == "1" else "",
        "initEntrSclCdAll": "",
        "initStdIndLrclCdAll": "",
        "initAccrSecdAll": "",
        "initAgeSecdAll": "",
        "initSxdsSecdAll": "",
        "initCnwkPrdCdAll": "",
        "initCycCdAll": "",
    }
    return post_json(s, "/pt/c/a/retrieveCstmWageRsltData.do", data)


def main():
    s = session()
    occupations = load_occupations(s)
    terms = {
        "사무": ["사무"],
        "마케팅": ["마케팅", "광고", "홍보"],
        "데이터": ["데이터"],
        "개발": ["소프트웨어", "시스템", "웹", "프로그래머"],
        "디자인": ["디자이너", "디자인"],
    }
    selected = []
    for group, needles in terms.items():
        group_rows = matches(occupations, needles)
        for row in group_rows:
            row["group"] = group
        selected.extend(group_rows)

    (OUT / "wagework_selected_occupation_codes.json").write_text(
        json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    results = []
    errors = []
    for row in selected:
        try:
            obj = result_for_occupation(s, row)
            row_out = dict(row)
            row_out["result"] = obj
            results.append(row_out)
            print("OK", row["group"], row["occpClCd"], row["occpCfnm"], obj.get("success"))
        except Exception as exc:
            errors.append({**row, "error": str(exc)})
            print("ERR", row["group"], row["occpClCd"], row["occpCfnm"], exc)
        time.sleep(0.15)

    (OUT / "wagework_selected_wage_results_raw.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "wagework_selected_wage_errors.json").write_text(
        json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    all_results = []
    all_errors = []
    for item in occupations:
        row = {
            "group": "전체",
            "occpClCd": item.get("occpClCd"),
            "occpCfnm": item.get("occpCfnm"),
            "upprCdId": item.get("upprCdId"),
            "strfLvlSn": item.get("strfLvlSn"),
        }
        try:
            obj = result_for_occupation(s, row)
            all_results.append({**row, "result": obj})
            print("ALL OK", row["occpClCd"], row["occpCfnm"], obj.get("success"))
        except Exception as exc:
            all_errors.append({**row, "error": str(exc)})
            print("ALL ERR", row["occpClCd"], row["occpCfnm"], exc)
        time.sleep(0.08)

    (OUT / "wagework_all_occupation_wage_results_raw.json").write_text(
        json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "wagework_all_occupation_wage_errors.json").write_text(
        json.dumps(all_errors, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
