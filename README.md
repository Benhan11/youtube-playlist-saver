RUN:
node script.js <listID> <listID> ...
./backup-playlists.bat

If invalid token grant:
1. Delete credentials/project_token.json)
2. Run script and follow token instructions
3. Rerun script as it won't have worked the first time

EXAMPLE:
https://www.youtube.com/playlist?list=THISPARTISTHELISTID

Output: 
/generated/playlists/YYYY-mm-dd/<listID>.json

Format generated JSON: 
SHIFT + ALT + F



Backup:
./backup-playlists.bat




Error:    The API returned an error: Error: invalid_grant
Solution: Delete project_token.json and run again

Error:    The API returned an error: Error: No filter selected. Expected one of: channelId, mine, id
Solution: Run again