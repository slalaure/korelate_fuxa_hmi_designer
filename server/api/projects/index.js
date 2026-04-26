/**
 * 'api/project': Project API to GET/POST project data
 */

var express = require("express");
const authJwt = require('../jwt-helper');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizeRelativePath, resolveWithin } = require('../path-helper');

var runtime;
var secureFnc;
var checkGroupsFnc;

module.exports = {
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },
    app: function () {
        var prjApp = express();
        prjApp.use(function(req,res,next) {
            if (!runtime.project) {
                res.status(404).end();
            } else {
                next();
            }
        });

        /**
         * GET Project data
         * Take from project storage and reply
         */
        prjApp.get("/api/project", secureFnc, function(req, res) {
            const permission = checkGroupsFnc(req);
            runtime.project.getProject(req.userId, permission).then(result => {
                // res.header("Access-Control-Allow-Origin", "*");
                // res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
                if (result) {
                    res.json(result);
                } else {
                    res.status(404).end();
                    runtime.logger.error("api get project: Not Found!");
                }
            }).catch(function(err) {
                if (err && err.code) {
                    if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
                        res.status(400).json({error:err.code, message: err.message});
                        runtime.logger.error("api get project: " + err.message);
                    }
                } else {
                    res.status(400).json({error:"unexpected_error", message: err});
                    runtime.logger.error("api get project: " + err);
                }
            });
        });

        /**
         * POST Project data
         * Set to project storage
         */
        prjApp.post("/api/project", secureFnc, function(req, res, next) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api post project: Tocken Expired");
            } else if (!authJwt.haveAdminPermission(permission)) {
                res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                runtime.logger.error("api post project: Unauthorized");
            } else {
                runtime.project.setProject(req.body).then(function(data) {
                    // Korelate Export: intercept full project save to export all views
                    if (req.body && req.body.hmi && req.body.hmi.views) {
                        req.body.hmi.views.forEach(view => exportKorelateView(view));
                    }
                    runtime.restart(true).then(function(result) {
                        res.end();
                    });
                }).catch(function(err) {
                    if (err && err.code) {
                        res.status(400).json({error:err.code, message: err.message});
                        runtime.logger.error("api post project: " + err.message);
                    } else {
                        res.status(400).json({error:"unexpected_error", message: err});
                        runtime.logger.error("api post project: " + err);
                    }
                });
            }
        });

        /**
         * POST Single Project data
         * Set the value (general/view/device/...) to project storage
         */
        prjApp.post("/api/projectData", secureFnc, function(req, res, next) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api post projectData: Tocken Expired");
            } else if (!authJwt.haveAdminPermission(permission)) {
                res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                runtime.logger.error("api post projectData: Unauthorized");
            } else {
                runtime.project.setProjectData(req.body.cmd, req.body.data).then(setres => {
                    // Korelate Export: intercept single view save
                    if (req.body.cmd === runtime.project.ProjectDataCmdType.SetView) {
                        exportKorelateView(req.body.data);
                    }
                    runtime.update(req.body.cmd, req.body.data).then(result => {
                        res.end();
                    });
                }).catch(function(err) {
                    if (err && err.code) {
                        res.status(400).json({error:err.code, message: err.message});
                        runtime.logger.error("api post projectData: " + err.message);
                    } else {
                        res.status(400).json({error:"unexpected_error", message: err});
                        runtime.logger.error("api post projectData: " + err);
                    }
                });
            }
        });

        /**
         * GET Project demo data
         * Take the project demo file from server folder
         */
        prjApp.get("/api/projectdemo", secureFnc, function (req, res) {
            const data = runtime.project.getProjectDemo();
            // res.header("Access-Control-Allow-Origin", "*");
            // res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
            if (data) {
                res.json(data);
            } else {
                res.status(404).end();
                runtime.logger.error("api get project: Not Found!");
            }
        });

        /**
         * GET Device property like security
         * Take from project storage and reply
         */
        prjApp.get("/api/device", secureFnc, function(req, res) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api get device: Tocken Expired");
            } else if (!authJwt.haveAdminPermission(permission)) {
                res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                runtime.logger.error("api get device: Unauthorized");
            } else {
                runtime.project.getDeviceProperty(req.query).then(result => {
                    // res.header("Access-Control-Allow-Origin", "*");
                    // res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
                    if (result) {
                        res.json(result);
                    } else {
                        res.end();
                    }
                }).catch(function(err) {
                    if (err && err.code) {
                        res.status(400).json({error:err.code, message: err.message});
                        runtime.logger.error("api get device: " + err.message);
                    } else {
                        res.status(400).json({error:"unexpected_error", message: err});
                        runtime.logger.error("api get device: " + err);
                    }
                });
            }
        });

        /**
         * POST Device property
         * Set to project storage
         */
        prjApp.post("/api/device", secureFnc, function(req, res, next) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api post device: Tocken Expired");
            } else if (!authJwt.haveAdminPermission(permission)) {
                res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                runtime.logger.error("api post device: Unauthorized");
            } else {
                runtime.project.setDeviceProperty(req.body.params).then(function(data) {
                    res.end();
                }).catch(function(err) {
                    if (err && err.code) {
                        res.status(400).json({error:err.code, message: err.message});
                        runtime.logger.error("api post device: " + err.message);
                    } else {
                        res.status(400).json({error:"unexpected_error", message: err});
                        runtime.logger.error("api post device: " + err);
                    }
                });
            }
        });

        /**
         * POST Upload file resource
         * images will be in media file saved
         */
        prjApp.post('/api/upload', secureFnc, function (req, res) {
            const permission = checkGroupsFnc(req);
            if (res.statusCode === 403) {
                runtime.logger.error("api get device: Tocken Expired");
                return;
            } else if (!authJwt.haveAdminPermission(permission)) {
                res.status(401).json({error:"unauthorized_error", message: "Unauthorized!"});
                runtime.logger.error("api get device: Unauthorized");
                return;
            }
            const file = req.body.resource;
            const destination = req.body.destination;
            try {
                let basedata = file.data;
                let encoding = {};
                // let basedata = file.data.replace(/^data:.*,/, '');
                // let basedata = file.data.replace(/^data:image\/png;base64,/, "");
                const rawFileName = typeof file.name === 'string' ? file.name : '';
                const safeFileName = normalizeRelativePath(rawFileName);
                const safeFullPath = normalizeRelativePath(file.fullPath || rawFileName);
                const relativePath = safeFullPath || safeFileName;
                if (!relativePath) {
                    res.status(400).json({error:"invalid_path", message: "Invalid upload path."});
                    return;
                }

                if (file.type !== 'svg') {
                    basedata = file.data.replace(/^data:.*,/, '');
                    encoding = {encoding: 'base64'};
                }
                const resolvedUpload = resolveWithin(runtime.settings.uploadFileDir, relativePath);
                if (!resolvedUpload) {
                    res.status(400).json({error:"invalid_path", message: "Invalid upload path."});
                    return;
                }
                let filePath = resolvedUpload.resolvedTarget;
                if (destination) {
                    const baseDir = process.versions.electron
                        ? (process.env.userDir || path.join(os.homedir(), '.fuxa'))
                        : runtime.settings.appDir;
                    const normalizedDestination = normalizeRelativePath(destination);
                    if (!normalizedDestination) {
                        res.status(400).json({error:"invalid_destination", message: "Invalid destination path."});
                        return;
                    }
                    const resolvedDestination = resolveWithin(baseDir, `_${normalizedDestination}`);
                    if (!resolvedDestination) {
                        res.status(400).json({error:"invalid_destination", message: "Invalid destination path."});
                        return;
                    }
                    const destinationDir = resolvedDestination.resolvedTarget;
                    const resolvedFile = resolveWithin(destinationDir, relativePath);
                    if (!resolvedFile) {
                        res.status(400).json({error:"invalid_path", message: "Invalid upload path."});
                        return;
                    }
                    filePath = resolvedFile.resolvedTarget;
                    const dir = path.dirname(filePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                }
                fs.writeFileSync(filePath, basedata, encoding);
                let result = {'location': '/' + runtime.settings.httpUploadFileStatic + '/' + relativePath };
                res.json(result);
            } catch (err) {
                if (err && err.code) {
                    res.status(400).json({error: err.code, message: err.message});
                    runtime.logger.error("api upload: " + err.message);
                } else {
                    res.status(400).json({error:"unexpected_error", message: err});
                    runtime.logger.error("api upload: " + err);
                }
            }
        });

        return prjApp;
    }
}

/**
 * Korelate Export: Helper function to generate static files for a view.
 * It creates a .html file with the SVG content and a .js file with a skeleton for bindings.
 * @param {Object} view FUXA View object containing 'name' and 'svgcontent'
 */
function exportKorelateView(view) {
    try {
        if (!view || !view.name || !view.svgcontent) {
            return;
        }

        // Define the export directory (korelate-export folder at the project root)
        const exportDir = path.join(runtime.settings.appDir, '..', 'korelate-export');
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        // Sanitize the view name to create valid filenames
        const fileName = view.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const htmlPath = path.join(exportDir, `${fileName}.html`);
        const jsPath = path.join(exportDir, `${fileName}.js`);

        let initLogic = '';
        let updateLogic = '';

        // Post-process SVG to inject Korelate data-* attributes
        let processedSvg = view.svgcontent;
        if (view.items) {
            Object.values(view.items).forEach(item => {
                if (item && item.id && item.property) {
                    const dataAttributes = [];
                    
                    // Main variable binding
                    if (item.property.variableId) {
                        const tagPath = resolveTagPath(item.property.variableId);
                        if (tagPath) {
                            dataAttributes.push(`data-key="${tagPath}"`);
                            
                            // Map FUXA types to Korelate attributes
                            if (item.type === 'text' || item.type === 'input') {
                                // Default for text is textContent, so data-attr can be omitted
                            } else if (item.type === 'rect' || item.type === 'circle' || item.type === 'path') {
                                dataAttributes.push(`data-attr="fill"`);
                            }
                        }
                    }

                    // Actions (Animations)
                    if (item.property.actions && item.property.actions.length > 0) {
                        item.property.actions.forEach(action => {
                            if (action.variableId) {
                                const actionTagPath = resolveTagPath(action.variableId);
                                if (actionTagPath) {
                                    if (!dataAttributes.some(attr => attr.includes(actionTagPath))) {
                                        dataAttributes.push(`data-action-key="${actionTagPath}"`);
                                    }
                                    const actionType = action.type ? action.type.replace('shapes.action-', '') : 'unknown';
                                    updateLogic += `
        if (topic === '${actionTagPath}') {
            const el_${item.id} = hmiRoot.querySelector('#${item.id}');
            if (el_${item.id} && msg !== undefined) {
                // TODO: Implement '${actionType}' animation for element ${item.id} based on msg
            }
        }`;
                                }
                            }
                        });
                    }

                    // Events (Interactions)
                    if (item.property.events && item.property.events.length > 0) {
                        item.property.events.forEach(ev => {
                            if (ev.type && ev.action) {
                                const eventType = ev.type.replace('shapes.event-', '');
                                const actionName = ev.action.replace('shapes.event-', '');
                                const targetTag = ev.actparam ? resolveTagPath(ev.actparam) : '';
                                
                                initLogic += `
        const el_${item.id}_ev = hmiRoot.querySelector('#${item.id}');
        if (el_${item.id}_ev) {
            context.addEventListener(el_${item.id}_ev, '${eventType}', (e) => {
                // TODO: Handle FUXA interaction '${actionName}'
                ${targetTag ? `// Target tag: ${targetTag}` : ''}
            });
        }`;
                            }
                        });
                    }

                    // Inject attributes into the SVG element tag
                    if (dataAttributes.length > 0) {
                        const attrString = dataAttributes.join(' ');
                        const elementRegex = new RegExp('(<[^>]*\\sid=["\']' + item.id + '["\'])([^>]*>)', 'i');
                        processedSvg = processedSvg.replace(elementRegex, `$1 ${attrString}$2`);
                    }
                }
            });
        }

        // Generate the .html file containing the processed SVG/HTML
        fs.writeFileSync(htmlPath, processedSvg);

        // Generate the .js file with the Korelate HMI bindings skeleton (only if it doesn't already exist)
        const jsContent = `window.registerHmiBindings({
    initialize: (hmiRoot, context) => {
        // Initialization logic (DOM events, timers, etc.)${initLogic}
    },
    update: (sourceId, topic, payload, hmiRoot, context) => {
        try {
            const msg = (typeof payload === 'string') ? JSON.parse(payload) : payload;${updateLogic}
        } catch (err) {
            // Silently ignore non-JSON payloads if your logic requires JSON
        }
    },
    reset: (hmiRoot) => {
        // Reset logic when view is unloaded
    }
});\n`;

        if (!fs.existsSync(jsPath)) {
            fs.writeFileSync(jsPath, jsContent);
        }
    } catch (err) {
        if (runtime && runtime.logger) {
            runtime.logger.error(`Korelate Export Error for view "${view ? view.name : 'unknown'}": ${err}`);
        } else {
            console.error('Korelate Export Error:', err);
        }
    }
}

/**
 * Korelate Export: Resolves a FUXA variableId (GUID) into a semantic path (DeviceName/TagName).
 * If the variableId is already an I3X semantic path (e.g. from the UNS Browser), it passes it through.
 * @param {string} variableId The GUID of the tag in FUXA, or an I3X semantic path
 * @returns {string|null} The resolved path or null if not found
 */
function resolveTagPath(variableId) {
    if (!variableId) return null;
    
    // FUXA internal tag GUIDs usually look like "tag_XXXX"
    if (!variableId.startsWith('tag_') && !variableId.startsWith('T_')) {
        // It's likely already a semantic I3X path (e.g. "l1_coating_head.pump_hz")
        return variableId;
    }

    try {
        const devices = runtime.project.getDevices();
        if (!devices) return null;

        for (const deviceId in devices) {
            const device = devices[deviceId];
            if (device && device.tags && device.tags[variableId]) {
                const tag = device.tags[variableId];
                return `${device.name}/${tag.name}`;
            }
        }
    } catch (err) {
        // Silent fail
    }
    return null;
}
