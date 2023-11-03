const cacheDir = 'js/cache/';

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
function setProgress($scope, $timeout, message) {
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
async function saveJson(json, path, prog) {
    prog(1, 0);
    await fetch('/api/save_json', {
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'File-Path': path
        },
        body: JSON.stringify(json)
    });
    prog(1, 1);
}

/**
 * Load data from json file.
 * @param {string} path Relative file path from web root directory (static)
 * @param {object} prog Functions that change progress
 */
async function loadJson(path, prog) {
    prog(1, 0);
    return await fetch(path).then(function (data) {
        prog(1, 1);
        return data.json();
    })
}

/**
 * Execute API request.
 * To avoid rate limitation of the API, the request and cool time timers are executed asynchronously,
 * and the API results are returned at the end of the longer timer.
 * @param {string} apiCall URL to retrieve results with fetch
 */
async function _fetchAPI(apiCall) {
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
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {number} page default: 1
 */
async function _fetchShipsPiece(api, page = 1) {
    const apiCall = api.url + '/wows/encyclopedia/ships/?application_id=' + api.key + '&language=en&limit=100&page_no=' + page;
    return _fetchAPI(apiCall);
}

/**
 * Retrieve all available ship data from the API
 * https://developers.wargaming.net/reference/all/wows/encyclopedia/ships/
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {object} prog Functions that change progress
 */
async function fetchShips(api, prog) {
    const first_page = await _fetchShipsPiece(api);
    const ships = first_page.data;
    const meta = first_page.meta;
    let count = meta.count;
    let page = meta.page + 1;
    prog(meta.total, count);
    for (; page <= meta.page_total; page++) {
        const result = await _fetchShipsPiece(api, page);
        count += result.meta.count;
        Object.assign(ships, result.data);
        prog(meta.total, count);
    }
    return new Promise((resolve, reject) => { resolve(ships) });
}

/**
 * Retrieve available modules data from a specified page
 * https://developers.wargaming.net/reference/all/wows/encyclopedia/modules/
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {number} page default: 1
 */
async function _fetchModulesPiece(api, page = 1) {
    const apiCall = api.url + '/wows/encyclopedia/modules/?application_id=' + api.key + '&language=en&limit=100&page_no=' + page;
    return _fetchAPI(apiCall);
}

/**
 * Retrieve all available modules data from the API
 * https://developers.wargaming.net/reference/all/wows/encyclopedia/modules/
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {object} prog Functions that change progress
 */
async function fetchModules(api, prog) {
    const first_page = await _fetchModulesPiece(api);
    const modules = first_page.data;
    const meta = first_page.meta;
    let count = meta.count;
    let page = meta.page + 1;
    prog(meta.total, count);
    for (; page <= meta.page_total; page++) {
        const result = await _fetchModulesPiece(api, page);
        count += result.meta.count;
        Object.assign(modules, result.data);
        prog(meta.total, count);
    }
    return new Promise((resolve, reject) => { resolve(modules) });
}

function getProperty(object, propertyPath) {
    if (!object) { return undefined }
    let result = object;
    const propertyArray = propertyPath.split('.');
    for (let i = 0; i <= propertyArray.length - 1; i += 1) {
        if (propertyArray[i] === '') { return undefined; }
        if (result[propertyArray[i]] === null) { return undefined; }
        if (typeof result[propertyArray[i]] === 'undefined') { return undefined; }
        result = result[propertyArray[i]];
    }
    return result;
}

/**
 * Replace the list of modules that can be equipped on the ship with the module performance obtained from the API.
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {object} prog Functions that change progress
 */
function _mergeModulesToShip(moduleTree, modules) {
    const newTree = {};
    for (const part of Object.keys(moduleTree)) {
        const attachables = moduleTree[part];// arr
        const partMod = {};
        for (const mod of attachables) {
            partMod[mod] = modules[mod];
        }
        newTree[part] = partMod
    }
    return newTree;
}

class ShipSpecFactory {
    constructor(ship, modules) {
        this.defDetect_ = getProperty(ship, 'default_profile.concealment.detect_distance_by_ship') || 0;
        this.upgrades_ = ship.upgrades;
        this.modules_ = _mergeModulesToShip(ship.modules, modules)
    }

    get defaultDetect() {
        return this.defDetect_
    }

    get bestDetect() {
        return this.calcBestDetect()
    }

    get maxSpeed() {
        return this.selectFastestEngineSpeed()
    }

    get torpedoes() {
        return this.sortTorpedoes();
    }

    get maxArtilleryRange() {
        return this.calcMaxArtilleryRange(this.selectMaxArtilleryRange())
    }

    calcBestDetect() {
        const upgCoef = this.upgrades_.includes(4265791408) ? 0.9 : 1;
        // base * Commanders'Skill * ConcealmentUpgrade
        return Math.round(this.defDetect_ * 0.9 * upgCoef * 10) / 10;
    }

    selectFastestEngineSpeed() {
        const engines = getProperty(this.modules_, 'engine');
        if (engines === undefined) {
            return 0;
        }
        const speeds = Object.keys(engines).map((engineId) => {
            return getProperty(engines[engineId], 'profile.engine.max_speed');
        })
        return Math.max(...speeds);
    }

    sortTorpedoes() {
        const torpedoes = getProperty(this.modules_, 'torpedoes');
        if (torpedoes === undefined) {
            return [];
        }
        return Object.keys(torpedoes).map((torpedoId) => {
            return getProperty(torpedoes[torpedoId], 'profile.torpedoes');
        }).sort((a, b) => { // Range > Speed > maxDamage
            const a_range = getProperty(a, 'distance') || 0;
            const b_range = getProperty(b, 'distance') || 0;
            if (a_range !== b_range) {
                return (a_range < b_range) ? 1 : -1;
            }
            const a_speed = getProperty(a, 'torpedo_speed') || 0;
            const b_speed = getProperty(b, 'torpedo_speed') || 0;
            if (a_speed !== b_speed) {
                return (a_speed < b_speed) ? 1 : -1;
            }
            const a_damage = getProperty(a, 'max_damage') || 0;
            const b_damage = getProperty(b, 'max_damage') || 0;
            if (a_damage !== b_damage) {
                return (a_damage < b_damage) ? 1 : -1;
            }
            return 0;
        })
    }

    selectMaxArtilleryRange() {
        const fireCtrls = getProperty(this.modules_, 'fire_control');
        if (fireCtrls === undefined) {
            return 0;
        }
        const range = Object.keys(fireCtrls).map((fireCtrlId) => {
            return getProperty(fireCtrls[fireCtrlId], 'profile.fire_control.distance');
        })
        return Math.max(...range);
    }

    calcMaxArtilleryRange(defaultRange) {
        // Calculate corrections due to upgrades and commander skills
        // It seems that there are almost no cases where you want to know the exact maximum range of the artillery,
        // so the default value is currently returned.
        return defaultRange
    }
}

/**
 * Based on the API data of ships and modules, calculate the performance specifications of ships and convert them into data.
 * @param {object} api {url: apiBaseURL, key: apiKey}
 * @param {object} prog Functions that change progress
 */
function makeShipSpec(ships, modules, prog) {
    const specs = {}
    const total = Object.keys(ships).length;
    prog(total, 0)
    Object.keys(ships).forEach((shipId, index) => {
        const ship = ships[shipId];
        const ssf = new ShipSpecFactory(ship, modules);
        specs[shipId] = {
            images: ship.images,
            is_premium: ship.is_premium,
            is_special: ship.is_special,
            name: ship.name,
            nation: ship.nation,
            ship_id: ship.ship_id,
            tier: ship.tier,
            type: ship.type,
            spec: {
                detect: {
                    default: ssf.defaultDetect,
                    best: ssf.bestDetect
                },
                max_speed: ssf.maxSpeed,
                torpedoes: ssf.torpedoes,
                max_art_range: ssf.maxArtilleryRange
            }
        }
        prog(total, index + 1);
    })
    return specs
}

const app = angular.module('cacheAPI', []);

app.controller('progress', ['$scope', '$timeout', function ($scope, $timeout) {
    $timeout(() => {$scope.status = 'Running';  $scope.stausColor = 'white'})
    $scope.progs = [];
    const api = {};
    let ships;
    const loadEnvProg = setProgress($scope, $timeout, 'Loading preferences');
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
        .then(() => { // Fetch ships list from API
            const fetchShipProg = setProgress($scope, $timeout, 'Retrieving list of available warships');
            return fetchShips(api, fetchShipProg)
        })
        .then((shipsData) => { // Save ships data into json file
            const saveShipProg = setProgress($scope, $timeout, 'Saving (ships.json)');
            saveJson(shipsData, cacheDir + 'ships.json', saveShipProg)
        })
        .then(() => { // Fetch modules list from API
            const fetchModulesProg = setProgress($scope, $timeout, 'Retrieving list of available modules');
            return fetchModules(api, fetchModulesProg);
        })
        .then((modulesData) => { // Save modules data into json file
            const saveModulesProg = setProgress($scope, $timeout, 'Saving (modules.json)');
            saveJson(modulesData, cacheDir + 'modules.json', saveModulesProg)
        })
        .then(() => { // Load ships json
            const loadShipsProg = setProgress($scope, $timeout, 'Loading saved ships data');
            return loadJson(cacheDir + 'ships.json', loadShipsProg);
        })
        .then((data) => { // Load modules json
            ships = data;
            const loadModulesProg = setProgress($scope, $timeout, 'Loading saved modules data');
            return loadJson(cacheDir + 'modules.json', loadModulesProg)
        })
        .then((modules) => { // Make ship specifications data
            const makeShipSpecProg = setProgress($scope, $timeout, 'Calculating ship specifications based on API data');
            return makeShipSpec(ships, modules, makeShipSpecProg);
        })
        .then((specsData) => { // Save ship specifications data
            const saveSpecsProg = setProgress($scope, $timeout, 'Saving (specs.json)');
            saveJson(specsData, cacheDir + 'specs.json', saveSpecsProg)
        }).then(() => {
            $timeout(() => {$scope.status = 'Completed Successfully'; $scope.stausColor = 'green'})
        })
        .catch((e) => {
            $timeout(() => {
                $scope.status = 'Error Occurred';
                $scope.stausColor = 'red';
                $scope.error = 'A problem occurred while performing the above process';
            })
            console.error(e);
        });
}]);
