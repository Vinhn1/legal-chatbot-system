import json
import os
import sys

def merge_configs(bak_path: str, cur_path: str):
    if not os.path.exists(bak_path) or not os.path.exists(cur_path):
        return
    try:
        with open(bak_path, 'r', encoding='utf-8') as f:
            bak_data = json.load(f)
        with open(cur_path, 'r', encoding='utf-8') as f:
            cur_data = json.load(f)

        preserve_keys = [
            'fb_enabled', 'fb_verify_token', 'fb_page_token', 'fb_page_id',
            'zalo_enabled', 'zalo_app_id', 'zalo_secret_key', 'zalo_access_token',
            'zalo_refresh_token', 'zalo_oa_id'
        ]
        for k in preserve_keys:
            if k in bak_data:
                cur_data[k] = bak_data[k]

        with open(cur_path, 'w', encoding='utf-8') as f:
            json.dump(cur_data, f, ensure_ascii=False, indent=2)
        print("Da bao luu cau hinh kenh va token thanh cong.")
    except Exception as e:
        print(f"Loi khi merge cau hinh: {e}")

if __name__ == "__main__":
    bak = sys.argv[1] if len(sys.argv) > 1 else "/tmp/rag_config.json.bak"
    cur = sys.argv[2] if len(sys.argv) > 2 else "ai-core/rag_config.json"
    merge_configs(bak, cur)
