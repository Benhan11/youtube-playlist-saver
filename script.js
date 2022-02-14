var fs = require('fs');
var readline = require('readline');
var {google} = require('googleapis');
var OAuth2 = google.auth.OAuth2;

// If modifying these scopes, delete previously saved credentials
// at ~/.credentials/project_token.json
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = './credentials/';
var TOKEN_PATH = TOKEN_DIR + 'project_token.json';

// Load client secrets from local file.
fs.readFile('client_secret.json', function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }

  let playlistIds = process.argv.slice(2);

  // Get all playlist items from input playlistId's
  playlistIds.forEach(pl => {
    authorize(JSON.parse(content), getPlaylist, pl);
  });
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback, cbArgs) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  var oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client, cbArgs);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized client.
 */
function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) throw err;
    console.log('Token stored to ' + TOKEN_PATH);
  });
}

/**
 * Lists names of items in specified user playlist.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function getPlaylist(auth, playlistId) {

  let itemsCount = 0;
  let data = {
    items: []
  }

  var service = google.youtube('v3');

  service.playlists.list({
    auth: auth,
    part: 'snippet',
    id: playlistId
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }

    let playlistInfo = response.data.items[0].snippet;

    service.playlistItems.list({
      auth: auth,
      part: 'snippet',
      playlistId: playlistId,
      maxResults: 50
    }, (err, response) => {
      if (err) {
        console.log('The API returned an error: ' + err);
        return;
      }
      
      var playlistItems = response.data.items;
      playlistItems.forEach(item => {
        data.items.push(item.snippet.title);
        itemsCount++;
      });
  
      recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
    });
  });
}

/**
 * Recurse through consequent pages.
 * 
 * @param {*} service Youtube api.
 * @param {google.auth.OAuth2} auth OAuth2.
 * @param {String} pageToken Next page reference.
 * @param {String} playlistId The playlist to iterate. 
 */
function recursePlaylistItemPages(service, auth, pageToken, playlistId, playlistInfo, data, itemsCount) {
  if (typeof(pageToken) != 'undefined') {
    service.playlistItems.list({
      auth: auth,
      part: 'snippet',
      playlistId: playlistId,
      maxResults: 50,
      pageToken: pageToken
    }, (err, response) => {
      if (err) {
        console.log('The API returned an error: ' + err);
        return;
      }
      
      var playlistItems = response.data.items;
      playlistItems.forEach(item => {
        data.items.push(item.snippet.title);
        itemsCount++;
      });

      recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
    });
  }
  else {
    fs.writeFileSync('./generated/playlists/' + '(' + playlistInfo.channelTitle + ') ' + playlistInfo.title + '.json', JSON.stringify(data));
    console.log('\nDone: (' + playlistInfo.channelTitle + ') ' + playlistInfo.title + ', ' + 'Items: ' + itemsCount + '\n' +
                playlistId + '\n');
  }
}