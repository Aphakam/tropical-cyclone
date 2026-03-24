import requests
import json
import os
import time

# List of storm IDs provided in the dropdown
STORM_IDS = [
    307, 306, 290, 284, 289, 288, 283, 279, 271, 267, 
    266, 265, 261, 257, 255, 254, 253, 252, 251, 248
]

def download_storm_data(ids, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    for storm_id in ids:
        output_file = os.path.join(output_dir, f"storm_{storm_id}.json")
        
        # Skip if file already exists
        if os.path.exists(output_file):
            print(f"Storm ID {storm_id} already exists. Skipping.")
            continue

        url = f"https://tmd.go.th/api/Weather/StormTrack?stormId={storm_id}"
        print(f"Downloading storm ID {storm_id} from {url}...")
        
        try:
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            
            # Check if data contains actual storm content
            if not data.get("stormTrackingData"):
                print(f"Warning: No tracking data found for storm ID {storm_id}")
                continue

            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            
            print(f"Saved to {output_file}")
            
        except requests.exceptions.RequestException as e:
            print(f"Error downloading storm ID {storm_id}: {e}")
        except json.JSONDecodeError:
            print(f"Error decoding JSON for storm ID {storm_id}")
        
        # Adding a small delay to be polite to the server
        time.sleep(0.5)

if __name__ == "__main__":
    download_storm_data(STORM_IDS, "data")
