var fs = require('fs');
var readline = require('readline');
var https = require('https');
var { google } = require('googleapis');
var OAuth2 = google.auth.OAuth2;

// If modifying these scopes, delete previously saved credentials
// at ~/.credentials/project_token.json
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = './credentials/';
var TOKEN_PATH = TOKEN_DIR + 'project_token.json';
var save_path = './generated/playlists/'



// Run the script
main()

/**
 * Loads client secrets, fixes the output directory, and makes the first 
 * authorization call, starting the process of communication with the 
 * Google API.
 */
function main() {
    fs.readFile('client_secret.json', function processClientSecrets(err, content) {
        if (err) {
            console.log('Error loading client secret file: ' + err);
            return;
        }

        if (make_save_directory() == false) return;

        authorize(JSON.parse(content), null);
    });
}
        

/**
 * Create an OAuth2 client with the given credentials if it doesn't exist, 
 * then validate the access token. Otherwise, validate the access token with
 * the updated OAuth2 client.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {google.auth.OAuth2} updatedOauth2Client An authorized OAuth2 client if not null.
 */
function authorize(credentials, updatedOauth2Client) {
    var oauth2Client = updatedOauth2Client;

    // Make the OAuth2 client if it doesn't exist.
    if (oauth2Client === null) {
        var clientSecret = credentials.installed.client_secret;
        var clientId = credentials.installed.client_id;
        var redirectUrl = credentials.installed.redirect_uris[0];
        oauth2Client = new OAuth2(clientId, clientSecret, redirectUrl);
    }

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, function (err, token) {
        if (err) {
            getNewToken(oauth2Client);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            validateToken(oauth2Client);
        }
    });
}


/**
 * Checks if the access token is valid. If it is, begins the process of playlist
 * saving, otherwise, begins the process of fetching a new token.
 * 
 * @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 */
function validateToken(oauth2Client) {
    https.get('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + oauth2Client.credentials.access_token, res => {
        let data = [];

        res.on('data', chunk => {
            data.push(chunk);
        });

        res.on('end', () => {
            const contents = JSON.parse(Buffer.concat(data).toString());
            
            if (res.statusCode === 200) {
                console.log("Token is valid.");
                save_playlists(oauth2Client);
            }
            else if (contents.error === 'invalid_token') {
                console.log("Token is invalid, get a new one: ");
                getNewToken(oauth2Client);
            }
            else {
                console.log('Token error: ' + contents.error);
                return;
            }
        });

    }).on('error', err => {
        console.log(err);
    });
}


/**
 * Get and store new token after prompting for user authorization, and then
 * attempt to authorize with the OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 */
function getNewToken(oauth2Client) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    console.log('\nAuthorize this app by visiting this url: ', authUrl);

    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Enter the code from that page here: ', function (code) {
        rl.close();
        oauth2Client.getToken(code, function (err, token) {
            if (err) {
                console.log('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            authorize(null, oauth2Client);
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
    } 
    catch (err) {
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
 * Check if save directory exists and creates it if it does not, otherwise,
 * overwrites it.
 * 
 * @returns {boolean} false if a directory manipulation error occurred.
 */
function make_save_directory() {
    // Make the save directory if it does not already exist
    try {
        // Make sure the main directory exists
        if (!fs.existsSync(save_path)) {
            fs.mkdirSync(save_path, {recursive: true});
        }

        // Create the instance specific save path
        const date = new Date();
        save_path += date.toISOString().split('T')[0] + '/';

        // Overwrite todays backup if there was one
        if (fs.existsSync(save_path)) {
            // Remove the directory and its files
            fs.rmSync(save_path, {recursive: true, force: true}, err => {
                if (err) throw err;
            });
        }
        fs.mkdirSync(save_path);

    }
    catch (err) {
        console.log(err);
        return false;
    }
}


/**
 * Saves the playlists specified via the command line arguments.
 * 
 *  @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 */
function save_playlists(oauth2Client) {
    let playlistIds = process.argv.slice(2);

    // Get all playlist items from input playlistId's
    playlistIds.forEach(listId => {
        getPlaylist(oauth2Client, listId);
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
    }, function (err, response) {
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
    if (typeof (pageToken) != 'undefined') {
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
        fs.writeFileSync(save_path + '(' + playlistInfo.channelTitle + ') ' + playlistInfo.title + '.json', JSON.stringify(data));
        console.log('\nDone: (' + playlistInfo.channelTitle + ') ' + playlistInfo.title + ', ' + 'Items: ' + itemsCount + '\n' +
            playlistId + '\n');
    }
}