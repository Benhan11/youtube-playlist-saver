var fs = require('fs');
var readline = require('readline');
var https = require('https');
var { google } = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var express = require('express');

// Token and save path related
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = './credentials/';
var TOKEN_PATH = TOKEN_DIR + 'project_token.json';
var save_path = './generated/playlists/'


// Initial setup
var app = express();
var port = 8080;
var homepage_url = 'index';
var service = google.youtube('v3');





/*---------------------------------------*/
/*-               WEB APP               -*/
/*---------------------------------------*/



app.set('view engine', 'ejs');
app.use(express.static(__dirname));

app.get('/', function(req, res) {
    executeFunction(getAndRenderPlaylistTitles, res);
});

app.post('/', function(req, res) {
    // TODO post
});

app.listen(port);
console.log('Server started at http://127.0.0.1:' + port);







/*---------------------------------------*/
/*-              API CALLS              -*/
/*---------------------------------------*/



/**
 * Loads client secrets and authorizes the execution of a function
 * involving API-calls.
 * 
 * @param {Function} callback The function to be executed.
 * @param {*} cbArgs Arguments for the callback. 
 */
function executeFunction(callback, cbArgs) {
    fs.readFile('client_secret.json', function processClientSecrets(err, content) {
        if (err) {
            console.log('Error loading client secret file: ' + err);
            return;
        }

        authorize(JSON.parse(content), null, callback, cbArgs);
    });
}
        

/**
 * Create an OAuth2 client with the given credentials if it doesn't exist, 
 * then validate the access token. Otherwise, validate the access token with
 * the updated OAuth2 client and send a callback.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {google.auth.OAuth2} updatedOauth2Client An authorized OAuth2 client if not null.
 * @param {Function} callback The callback to be sent.
 * @param {*} cbArgs Arguments for the callback. 
 */
function authorize(credentials, updatedOauth2Client, callback, cbArgs) {
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
            getNewToken(oauth2Client, callback, cbArgs);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            validateTokenAndExecute(oauth2Client, callback, cbArgs);
        }
    });
}


/**
 * Checks if the access token is valid. If it is, begins the callback
 * process, otherwise, begins the process of fetching a new token.
 * 
 * @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 * @param {Function} callback The callback to be executed.
 * @param {*} cbArgs Arguments for the callback. 
 */
function validateTokenAndExecute(oauth2Client, callback, cbArgs) {
    https.get('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + oauth2Client.credentials.access_token, res => {
        let data = [];

        res.on('data', chunk => {
            data.push(chunk);
        });

        res.on('end', () => {
            const contents = JSON.parse(Buffer.concat(data).toString());
            
            if (res.statusCode === 200 && contents.error !== 'invalid_token') {
                console.log("Token is valid.");
                callback(oauth2Client, cbArgs);
            }
            else if (contents.error === 'invalid_token') {
                console.log("Token is invalid.");
                getNewToken(oauth2Client, callback, cbArgs);
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
 * @param {Function} callback The callback to be executed.
 * @param {*} cbArgs Arguments for the callback. 
 */
function getNewToken(oauth2Client, callback, cbArgs) {
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
            authorize(null, oauth2Client, callback, cbArgs);
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
        console.log('\nToken stored to ' + TOKEN_PATH);
    });
}


/**
 * Check if save directory exists and creates it if it does not, otherwise,
 * overwrites it. Throws an error in the case of a directory manipulation
 * fault.
 */
function makeSaveDirectory() {
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


/**
 * Fetches and renders the users playlist titles.
 * 
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} renderObject The web-response object to be served for rendering.
 */
function getAndRenderPlaylistTitles(auth, renderObject) {
    // Get the channel id of the user.
    service.channels.list({
        auth: auth,
        part: 'id',
        mine: true
    }, function (err, response) {
        if (err) {
            console.log(err);
        }

        let channelId = response.data.items[0].id;

        getPlaylistTitles(auth, renderObject, channelId);
    });
}


/**
 * Gathers all the playlist names for the specified channel, does so
 * by recursively calling subsequent data pages, to be rendered.
 * 
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} renderObject The web-response object to be served for rendering.
 * @param {String} channelId The id identifying the channel. 
 */
function getPlaylistTitles(auth, renderObject, channelId) {
    let itemsCount = 0;
    let data = {
        items: []
    }

    // Get first page of playlists
    service.playlists.list({
        auth: auth,
        part: 'snippet',
        channelId: channelId
    }, function (err, response) {
        if (err) {
            console.log(err);
        }
        
        [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items);

        recursePlaylistPages(auth, renderObject, channelId, response.data.nextPageToken, data, itemsCount);
    });
}


/**
 * Gather the playlist titles from subsequent pages and initiate rendering.
 * 
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} renderObject The web-response object to be served for rendering.
 * @param {String} channelId The id identifying the channel. 
 * @param {String} pageToken Next page reference.
 * @param {Object} data The object for storing collected playlist data. 
 * @param {Number} itemsCount The number of items collected so far. 
 */
function recursePlaylistPages(auth, renderObject, channelId, pageToken, data, itemsCount) {
    if (typeof (pageToken) != 'undefined') {
        service.playlists.list({
            auth: auth,
            part: 'snippet',
            channelId: channelId,
            pageToken: pageToken
        }, function (err, response) {
            if (err) {
                console.log(err);
            }
            
            [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items);

            recursePlaylistPages(auth, renderObject, channelId, response.data.nextPageToken, data, itemsCount);
        });
    }
    // When there are no more pages
    else {
        playlistsSorted = data.items.sort();
        
        renderPlaylistTitles(renderObject, playlistsSorted, itemsCount);
    }
}


/**
 * Serves a web-page response to the client with the playlist titles.
 * 
 * @param {Object} response The web-response object to be served for rendering.
 * @param {Array} playlistTitles The playlist titles.
 * @param {Number} itemsCount The number of titles collected. 
 */
function renderPlaylistTitles(response, playlistTitles, itemsCount) {
    response.render(homepage_url, {
        playlistTitles: playlistTitles,
        itemsCount: itemsCount
    });
}


/**
 * Saves the playlists specified via the command line arguments.
 * 
 *  @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 */
function savePlaylists(oauth2Client) {
    let playlistIds = process.argv.slice(2);

    // Get all playlist items from input playlistId's
    playlistIds.forEach(listId => {
        getPlaylist(oauth2Client, listId);
    });
}


/**
 * Get playlist information and initiate call for retrieval of
 * the playlist's items.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {String} playlistId The id of the selected playlist.
  */
function getPlaylist(auth, playlistId) {
    service.playlists.list({
        auth: auth,
        part: 'snippet',
        id: playlistId
    }, function (err, response) {
        if (err) {
            console.log('The API returned an error: ' + err);
            return;
        }

        getPlaylistItems(service, auth, response, playlistId);
    });
}


/**
 * Get a playlist's items and collect them as data. Recursively
 * gather data from subsequent page requests.
 * 
 * @param {youtube_v3.Youtube} service The Youtube service.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} response The response containing general playlist information.
 * @param {String} playlistId The id of the selected playlist. 
 */
function getPlaylistItems(service, auth, response, playlistId) {
    let playlistInfo = response.data.items[0].snippet;

    let itemsCount = 0;
    let data = {
        items: []
    }

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

        [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items);

        recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
    });
}


/**
 * Recurse through consequent pages gathering data. Write out 
 * to file after the last page.
 * 
 * @param {youtube_v3.Youtube} service The Youtube service.
 * @param {google.auth.OAuth2} auth OAuth2.
 * @param {String} pageToken Next page reference.
 * @param {String} playlistId The playlist to iterate. 
 * @param {Object} playlistInfo The relevant playlist information.
 * @param {Object} data The object for storing collected playlist data. 
 * @param {Number} itemsCount The number of items collected so far. 
 */
function recursePlaylistItemPages(service, auth, pageToken, playlistId, playlistInfo, data, itemsCount) {
    // If it's not the last page
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

            [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items);

            recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
        });
    }
    // If it is the last page
    else {
        fs.writeFileSync(save_path + '(' + playlistInfo.channelTitle + ') ' + playlistInfo.title + '.json', JSON.stringify(data));
        
        console.log('\nDone: (' + playlistInfo.channelTitle + ') ' + playlistInfo.title + ', ' + 'Items: ' + itemsCount + '\n' +
            playlistId + '\n');
    }
}


/**
 * Utility function for handling items from a request, updating 
 * the data object and incrementing the number of counted items, 
 * returning both the updated values.
 * 
 * @param {Object} data The object for storing collected data. 
 * @param {Number} itemsCount The number of items collected so far. 
 * @param {Array} items The array containing the items. 
 * @returns {Array} Updated data object and number of counted items.
 */
function pushNewData(data, itemsCount, items) {
    items.forEach(item => {
        data.items.push(item.snippet.title);
        itemsCount++;
    });
    return [data, itemsCount];
}