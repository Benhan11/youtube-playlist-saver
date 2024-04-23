var fs = require('fs');
var https = require('https');
var { google } = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var express = require('express');
var bodyParser = require('body-parser');
const { exec } = require('child_process');


// Token and save path related
var SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
var TOKEN_DIR = './credentials/';
var TOKEN_PATH = TOKEN_DIR + 'project_token.json';
var OUTPUT_PATH = './generated/playlists/'
var save_path;


// Initial setup
var app = express();
var host_url = 'http://localhost';
var port = 8080;
var homepage_url = 'index';
var authorize_url = 'authorize';
var success_url = 'success';
var error_url = 'error';
var service = google.youtube('v3');
var oauth2Client = null;


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


/**
 * Request routing
 */

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

app.post('/authorize', bodyParser.urlencoded({ extended: true }), function(req, res) {
    let authCode = req.body.authCode;
    
    executeFunction(null, {res, authCode});
});


/**
 * Start app
 */

app.listen(port);
console.log('Server started at ' + host_url + ':' + port);

openBrowser();





/*---------------------------------------*/
/*-        API CALLS AND UTILITY        -*/
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

        authorize(JSON.parse(content), callback, cbArgs);
    });
}
        

/**
 * Create an OAuth2 client with the given credentials if it doesn't exist, 
 * then validate the access token. Otherwise, validate the access token with
 * the updated OAuth2 client and pass along a callback.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {Function} callback The callback to be sent.
 * @param {*} cbArgs Arguments for the callback. 
 */
function authorize(credentials, callback, cbArgs) {
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
            handleAuthorization(callback, cbArgs);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            validateTokenAndExecute(callback, cbArgs);
        }
    });
}


/**
 * Checks if the access token is valid. If it is, begins the callback
 * process, otherwise, begins the process of fetching a new token.
 * 
 * @param {Function} callback The callback to be executed.
 * @param {*} cbArgs Arguments for the callback. 
 */
function validateTokenAndExecute(callback, cbArgs) {
    https.get('https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + oauth2Client.credentials.access_token, res => {
        let data = [];

        res.on('data', chunk => {
            data.push(chunk);
        });

        res.on('end', () => {
            const contents = JSON.parse(Buffer.concat(data).toString());
            
            if (res.statusCode === 200 && contents.error !== 'invalid_token') {
                callback(cbArgs);
            }
            else if (contents.error === 'invalid_token') {
                console.log("Token is invalid.");
                handleAuthorization(callback, cbArgs);
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
 * Interprets the current state of authorization and decides whether
 * authorization needs to be started or if it is ready to be completed.
 * Originally, the callback would have been sent to be executed, if it
 * has ended up in the authorization flow it means there is currently
 * no token. If the callback is null, authorization should be finished
 * as that is the indication.
 * 
 * @param {Function} callback Callback indicating state of authorization.
 * @param {*} args Arguments to be sent to the authorization functions.
 */
function handleAuthorization(callback, args) {
    if (callback !== null)  startAuthorization(args);
    else                    finishAuthorization(args);
}


/**
 * Get the authorization url and render the authorization page.
 *
 * @param {Object} renderObject The web-response object to be served for rendering.
 */
function startAuthorization(renderObject) {
    var authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    
    renderObject.render(authorize_url, {
        authUrl: authUrl
    });
}


/**
 * Using an authorization code, gets and stores the access token using
 * the OAuth2 client. Lastly, attempts to redirect to the home page.
 * 
 * @param {Object} obj An object
 * @param {Object} obj.res The response object to redirect with.
 * @param {String} obj.authCode The authorization code. 
 */
function finishAuthorization({res, authCode}) {
    oauth2Client.getToken(authCode, function(err, token) {
        if (err) {
            console.log('Error while trying to retrieve access token.', err);
        }
        else {
            oauth2Client.credentials = token;
            storeToken(token);
        }

        res.redirect('/');
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
 * Opens a browser to the served home page.
 */
function openBrowser() {
    exec(('start ' + host_url + ':' + port), (err, stdout, stderr) => {
        if (err)    console.log('Failed to open browser:' + err + '\n');
        else        console.log('Opened browser at ' + host_url + ':' + port + '\n');
    });
}


/**
 * Opens a filer explorer window to the output folder.
 */
function openFileExplorer() {
    let formattedPath = save_path.replace('/', '\\');
    exec('start "" "' + formattedPath + '"');
}


/**
 * Fetches and renders the users playlist titles.
 * 
 * @param {Object} renderObject The web-response object to be served for rendering.
 */
function getAndRenderPlaylistTitles(renderObject) {
    // Get the channel id of the user.
    service.channels.list({
        auth: oauth2Client,
        part: 'id',
        mine: true
    }, function (err, response) {
        if (err) {
            console.log(err);
        }

        let channelId = response.data.items[0].id;

        getPlaylistTitles(renderObject, channelId);
    });
}


/**
 * Gathers all the playlists for the specified channel, does so
 * by recursively calling subsequent data pages, to be rendered.
 * Does not include playlist items.
 * 
 * @param {Object} renderObject The web-response object to be served for rendering.
 * @param {String} channelId The id identifying the channel. 
 */
function getPlaylistTitles(renderObject, channelId) {
    let data = {
        items: []
    }

    // Get first page of playlists
    service.playlists.list({
        auth: oauth2Client,
        part: 'snippet',
        channelId: channelId
    }, function (err, response) {
        if (err) {
            console.log(err);
        }
        
        data = pushNewData(data, response.data.items, true);

        recursePlaylistPages(renderObject, channelId, response.data.nextPageToken, data);
    });
}


/**
 * Gather the playlists from subsequent pages and initiate rendering.
 * 
 * @param {Object} renderObject The web-response object to be served for rendering.
 * @param {String} channelId The id identifying the channel. 
 * @param {String} pageToken Next page reference.
 * @param {Object} data The object for storing collected playlist data. 
 */
function recursePlaylistPages(renderObject, channelId, pageToken, data) {
    if (typeof (pageToken) != 'undefined') {
        service.playlists.list({
            auth: oauth2Client,
            part: 'snippet',
            channelId: channelId,
            pageToken: pageToken
        }, function (err, response) {
            if (err) {
                console.log(err);
            }
            
            data = pushNewData(data, response.data.items, true);

            recursePlaylistPages(renderObject, channelId, response.data.nextPageToken, data);
        });
    }
    // When there are no more pages
    else {
        playlistsSorted = data.items.sort(compareTitles);
        
        renderPlaylistTitles(renderObject, playlistsSorted);
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
 */
function renderPlaylistTitles(response, playlists) {
    response.render(homepage_url, {
        playlists: playlists
    });
}


/**
 * Saves the playlists specified via playlist id and waits
 * for all playlists to be fetched, then initiates rendering
 * of the resulting page.
 * 
 * @param {Object} obj An object
 * @param {Object} obj.renderObject The web-response object to be served for rendering.
 * @param {Array} obj.playlistIds Ids for the playlists to be saved.
 */
function savePlaylistsAndRenderResults({renderObject, playlistIds}) {
    completedAPICalls = 0;
    fetchedPlaylists = [];

    playlistIds.forEach(listId => {
        getPlaylist(listId);
    });

    waitForPlaylistsToSaveThenRenderResponse(renderObject, playlistIds.length);
}


/**
 * Get playlist information and initiate call for retrieval of
 * the playlist's items.
 *
 * @param {String} playlistId The id of the selected playlist.
  */
function getPlaylist(playlistId) {
    service.playlists.list({
        auth: oauth2Client,
        part: 'snippet',
        id: playlistId
    }, function (err, response) {
        if (err) {
            console.log('The API returned an error: ' + err);
            return;
        }

        getPlaylistItems(service, response, playlistId);
    });
}


/**
 * Get a playlist's items and collect them as data. Recursively
 * gather data from subsequent page requests.
 * 
 * @param {youtube_v3.Youtube} service The Youtube service.
 * @param {Object} response The response containing general playlist information.
 * @param {String} playlistId The id of the selected playlist. 
 */
function getPlaylistItems(service, response, playlistId) {
    let playlistInfo = response.data.items[0].snippet;

    let data = {
        items: []
    }

    service.playlistItems.list({
        auth: oauth2Client,
        part: 'snippet',
        playlistId: playlistId,
        maxResults: 50
    }, (err, response) => {
        if (err) {
            console.log('The API returned an error: ' + err);
            return;
        }

        data = pushNewData(data, response.data.items, false);

        recursePlaylistItemPages(service, response.data.nextPageToken, playlistId, playlistInfo, data);
    });
}


/**
 * Recurse through consequent pages gathering data. When finished
 * fetching the last page, pass along the data to be processed.
 * 
 * @param {youtube_v3.Youtube} service The Youtube service.
 * @param {String} pageToken Next page reference.
 * @param {String} playlistId The playlist to iterate. 
 * @param {Object} playlistInfo The relevant playlist information.
 * @param {Object} data The object for storing collected playlist data. 
 */
function recursePlaylistItemPages(service, pageToken, playlistId, playlistInfo, data) {
    // If it's not the last page
    if (typeof (pageToken) != 'undefined') {
        service.playlistItems.list({
            auth: oauth2Client,
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50,
            pageToken: pageToken
        }, (err, response) => {
            if (err) {
                console.log('The API returned an error: ' + err);
                return;
            }

            data = pushNewData(data, response.data.items, false);

            recursePlaylistItemPages(service, response.data.nextPageToken, playlistId, playlistInfo, data);
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
            
            response.render(success_url, {
                'playlists': fetchedPlaylists,
                'savePath': save_path
            });

            console.log();
            openFileExplorer();
        }
    }, 500);
}


/**
 * Utility function for handling items from a request, updating 
 * the data object and returning it.
 * 
 * @param {Object} data The object for storing collected data. 
 * @param {Array} newItems The array containing the items. 
 * @param {Boolean} includeListId Decides whether or not to include id.
 * @returns {Array} Updated data array.
 */
function pushNewData(data, newItems, includeListId) {
    newItems.forEach(item => {
        let newData;
        if (!includeListId) newData = item.snippet.title;
        else newData = {
            title: item.snippet.title,
            listId: item.id
        }

        data.items.push(newData);
    });
    return data;
}
