RUN:
node script.js <listID> <listID> ...

(If invalid token grant simply delete project_token.json)

EXAMPLE:
https://www.youtube.com/playlist?list=THISPARTISTHELISTID

Output: 
/generated/<listID>.json

Format generated JSON: 
SHIFT + ALT + F



Backup:
./backup-playlists.bat




Error:    The API returned an error: Error: invalid_grant
Solution: Delete project_token.json and run again

Error:    The API returned an error: Error: No filter selected. Expected one of: channelId, mine, id
Solution: Run again