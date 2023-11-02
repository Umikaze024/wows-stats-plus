const shipSpecDir = 'js/ship_spec/';

const coolTime = 1000 / 5; // millisecond / request, Standalone applications are limited to 10 requests per second
const coolTimer = () => {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, coolTime, undefined);
    });
}

/**
* Add a new progress to the view and return a function to change the progress rate.
* @param {object} $scope $scorpe in Angular.js
* @param {object} $timeout $timeout in Angular.js
* @param {string} message Description of new progress
*/
function setProgress($scope, $timeout, message){
    const newProg = {
        total: 0,
        count: 0,
        percentage: 0.0,
        message: message
    };
    $timeout(() => {
        $scope.progs.push(newProg);
    });
    /**
    * Save the data as a json file to the specified path.
    * @param {number} total Denominator for displaying progress rate
    * @param {number} count Numerator for displaying progress rate
    */
    return (total, count) => {
        $timeout(() => {
            newProg.total = total;
            newProg.count = count;
            newProg.percentage = Number.parseFloat(count / total * 100).toFixed(1);
        });
    };
}

/**
 * Save the data as a json file to the specified path.
 * @param {object} json json data to save
 * @param {string} path Relative file path from web root directory (static)
 * @param {object} prog Functions that change progress
 */
async function saveJson(json, path, prog){
    prog(1,0);
    await fetch('/api/save_json', {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'File-Path': path
        },
        body: JSON.stringify(json)
    });
    prog(1,1);
}

/**
 * Execute API request.
 * To avoid rate limitation of the API, the request and cool time timers are executed asynchronously,
 * and the API results are returned at the end of the longer timer.
 * @param {string} apiCall URL to retrieve results with fetch
 */
async function _fetchAPI(apiCall){
    return await Promise.all([fetch(apiCall), coolTimer()])
        .then((res) => {
            const [apiResult] = res.filter(v => v);
            if (apiResult.ok) {
                return apiResult.json()
            }
        });
}

/**
 * Retrieve ship data from a specified page
 * https://developers.wargaming.net/reference/all/wows/encyclopedia/ships/
 * @param {Object} api {url: apiBaseURL, key: apiKey}
 * @param {Number} page default: 1
 */
async function _fetchShipsPiece(api, page = 1){
    const apiCall = api.url + '/wows/encyclopedia/ships/?application_id=' + api.key + '&language=en&limit=100&page_no=' + page;
    return _fetchAPI(apiCall);
}

/**
 * Retrieve all available ship data from the API
 * https://developers.wargaming.net/reference/all/wows/encyclopedia/ships/
 * @param {Object} api {url: apiBaseURL, key: apiKey}
 * @param {object} prog Functions that change progress
 */
async function fetchShips(api, prog){
    const first_page = await _fetchShipsPiece(api);
    const ships = first_page.data;
    const meta = first_page.meta;
    let count = meta.count;
    let page = meta.page + 1;
    prog(meta.total, count);
    for (; page <= meta.page_total; page++){
        const result = await _fetchShipsPiece(api, page);
        count += result.meta.count;
        Object.assign(ships, result.data);
        prog(meta.total, count);
    }
    return new Promise((resolve, reject) => {resolve(ships)});
}


const app = angular.module('fetchShipsSpec', []);

app.controller('progress', ['$scope', '$timeout', function($scope, $timeout){
    $scope.progs = [];
    const api = {};
    const loadEnvProg = setProgress($scope ,$timeout, 'Loading preferences');
    loadEnvProg(1, 0);
    fetch('/api/env')
    .then((response) => {
        return response.json();
    })
    .then((env) => {
        api.key = env.API_KEY;
        api.url = env.API_URL;
        loadEnvProg(1, 1);
    })
    .then(() => { // Fetch ship list from API
        const fetchShipProg = setProgress($scope ,$timeout, 'Retrieving list of available warships');
        return fetchShips(api, fetchShipProg)
    })
    .then((shipsData) => { // Save API data into json file
        const saveShipProg = setProgress($scope ,$timeout, 'saving');
        saveJson(shipsData, shipSpecDir + 'ships.json', saveShipProg)
    })
    .catch((e) => {
        console.error(e);
    });
}]);
