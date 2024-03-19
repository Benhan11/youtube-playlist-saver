var fs = require('fs');
var readline = require('readline');
var https = require('https');
var { google } = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var express = require('express');
var bodyParser = require('body-parser');

// Token and save path related
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = './credentials/';
var TOKEN_PATH = TOKEN_DIR + 'project_token.json';
var OUTPUT_PATH = './generated/playlists/'
var save_path;


// Initial setup
var app = express();
var port = 8080;
var homepage_url = 'index';
var success_url = 'success';
var error_url = 'error';
var service = google.youtube('v3');


// Synchronization variable for multiple asynchronous API-calls
var completedAPICalls; 
var timeoutMilliseconds = 10000;
var fetchedPlaylists = [];





/*---------------------------------------*/
/*-               WEB APP               -*/
/*---------------------------------------*/



app.set('view engine', 'ejs');
app.use(express.static(__dirname));
app.use(bodyParser.json());


app.get('/', function(req, res) {
    executeFunction(getAndRenderPlaylistTitles, res);
});


app.post('/', bodyParser.urlencoded({ extended: true }), function(req, res) {
    // Filter selected playlists
    let selectedPlaylists = req.body.selectedPlaylists.filter((playlist) => {
        return playlist.split('|')[1] === 'true';
    });

    // Take only the id
    selectedPlaylists = selectedPlaylists.map(playlist => playlist.split('|')[0]);
    
    makeSaveDirectory();
    executeFunction(savePlaylistsAndRenderResults, {
        renderObject: res, 
        playlistIds: selectedPlaylists
    });
});

app.listen(port);
console.log('Server started at http://127.0.0.1:' + port + '\n');





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
    if (!fs.existsSync(OUTPUT_PATH)) {
        fs.mkdirSync(OUTPUT_PATH, {recursive: true});
    }

    // Create the instance specific save path
    const date = new Date();
    save_path = OUTPUT_PATH + date.toISOString().split('T')[0] + '/';

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
 * Gathers all the playlists for the specified channel, does so
 * by recursively calling subsequent data pages, to be rendered.
 * Does not include playlist items.
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
        
        [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items, true);

        recursePlaylistPages(auth, renderObject, channelId, response.data.nextPageToken, data, itemsCount);
    });
}


/**
 * Gather the playlists from subsequent pages and initiate rendering.
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
            
            [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items, true);

            recursePlaylistPages(auth, renderObject, channelId, response.data.nextPageToken, data, itemsCount);
        });
    }
    // When there are no more pages
    else {
        playlistsSorted = data.items.sort(compareTitles);
        
        renderPlaylistTitles(renderObject, playlistsSorted, itemsCount);
    }
}


/**
 * Comparison function for determining title order amongst playlists.
 * 
 * @param {Object} p1 The first playlist.
 * @param {Object} p2 The second playlist.
 * @returns 1, -1, or 0 depending on the comparison.
 */
function compareTitles(p1, p2) {
    const title1 = p1.title.toUpperCase();
    const title2 = p2.title.toUpperCase();

    if (title1 < title2) return -1;
    if (title1 > title2) return 1;
    return 0;
}


/**
 * Serves a web-page response to the client with the playlists.
 * 
 * @param {Object} response The web-response object to be served for rendering.
 * @param {Array} playlists The playlists.
 * @param {Number} itemsCount The number of titles collected. 
 */
function renderPlaylistTitles(response, playlists, itemsCount) {
    response.render(homepage_url, {
        playlists: playlists,
        itemsCount: itemsCount
    });
}


/**
 * Saves the playlists specified via playlist id and waits
 * for all playlists to be fetched, then initiates rendering
 * of the resulting page.
 * 
 * @param {google.auth.OAuth2} oauth2Client An authorized OAuth2 client.
 * @param {Object} obj An object
 * @param {Object} obj.renderObject The web-response object to be served for rendering.
 * @param {Array} obj.playlistIds Ids for the playlists to be saved.
 */
function savePlaylistsAndRenderResults(oauth2Client, {renderObject, playlistIds}) {
    completedAPICalls = 0;

    playlistIds.forEach(listId => {
        getPlaylist(oauth2Client, listId);
    });

    waitForPlaylistsToSaveThenRenderResponse(renderObject, playlistIds.length);
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

        [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items, false);

        recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
    });
}


/**
 * Recurse through consequent pages gathering data. When finished
 * fetching the last page, pass along the data to be processed.
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

            [ data, itemsCount ] = pushNewData(data, itemsCount, response.data.items, false);

            recursePlaylistItemPages(service, auth, response.data.nextPageToken, playlistId, playlistInfo, data, itemsCount);
        });
    }
    // If it is the last page
    else {        
        finishPlaylistFetch(playlistInfo, data);
    }
}


/**
 * Code to be executed after the complete fetch of a playlist,
 * such as, writing the data to a file, and passing along data
 * to be rendered in a response.
 * 
 * @param {Object} playlistInfo The playlist information.
 * @param {Array} playlistContent The contens of the playlist.
 */
function finishPlaylistFetch(playlistInfo, playlistContent) {
    fs.writeFileSync(save_path + '(' + playlistInfo.channelTitle + ') ' + playlistInfo.title + '.json', JSON.stringify(playlistContent));
    fetchedPlaylists = [
        ...fetchedPlaylists, 
        { title: playlistInfo.title, itemsCount: playlistContent.items.length }
    ];
    completedAPICalls++;
}


/**
 * Waits for playlists to be fetched and saved, checks
 * the status of this process every 200 milliseconds and
 * renders a page. If this process takes too long a 
 * timeout will cause an error page to be rendered instead.
 * 
 * @param {Object} response The object to render.
 * @param {Number} expectedPlaylists Expected nubmer of playlists.
 */
function waitForPlaylistsToSaveThenRenderResponse(response, expectedPlaylists) {
    timeout = setTimeout(() => {
        clearInterval(checkStatus);
        response.render(error_url);

    }, timeoutMilliseconds);

    checkStatus = setInterval(() => {
        console.log(completedAPICalls + ' completed out of ' + expectedPlaylists);

        if (completedAPICalls >= expectedPlaylists) {
            clearTimeout(timeout);
            clearInterval(checkStatus);
            
            response.render(success_url, {'playlists': fetchedPlaylists});
        }
    }, 500);
}


/**
 * Utility function for handling items from a request, updating 
 * the data object and incrementing the number of counted items, 
 * returning both the updated values.
 * 
 * @param {Object} data The object for storing collected data. 
 * @param {Number} itemsCount The number of items collected so far. 
 * @param {Array} items The array containing the items. 
 * @param {Boolean} includeListId Decides whether or not to include id.
 * @returns {Array} Updated data object and number of counted items.
 */
function pushNewData(data, itemsCount, newItems, includeListId) {
    newItems.forEach(item => {
        let newData;
        if (!includeListId) newData = item.snippet.title;
        else newData = {
            title: item.snippet.title,
            listId: item.id
        }

        data.items.push(newData);
        itemsCount++;
    });
    return [data, itemsCount];
}