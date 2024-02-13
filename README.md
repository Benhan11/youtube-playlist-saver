### Do not make public! (Google Developer terms)

# Youtube Playlist Saver

### Run
`node script.js <listID> <listID> ...`

`./backup-playlists.bat`

#### listID
https://www.youtube.com/playlist?list=
***listID***

### Output
*./generated/playlists/YYYY-mm-dd/\<listID\>.json*


### Errors
#### Invalid token grant
1. Delete *./credentials/project_token.json*
2. Run script and follow token instructions
3. Rerun script as it won't have worked the first time

#### No filter selected
1. Run again
