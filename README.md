# Youtube Playlist Saver

## Description
This personal web application fetches and saves the user's Youtube playlists for backup purposes.
The app runs on [Node.js](https://nodejs.org/en), making API requests to the Youtube Data API, 
processing the responses, and serving dynamic web pages using [Express](https://expressjs.com/)
and [EJS](https://ejs.co/). An authorized session is established with an OAuth2 handshake resulting
in an access token being granted by the Google API. Backups are saved as JSON files, fit for
further development.


## Installation instructions
***NOTE*** As this project was intended only for personal use, anyone seeking to try this out for themselves
will need to create their own Google Developer project and request a project token.

1. **Clone the repository**
```
git clone https://github.com/Benhan11/youtube-playlist-saver.git
```

2. **Add project token to `credentials/project_token.json`**

3. **Install dependencies**
```
npm install
```


## Usage
```
node app.js
```


## Dependencies
- Google APIs (v67.1.1)
- Google Auth Library (v7.0.2)
- Express.js (v4.18.2)
- EJS (v3.1.9)
