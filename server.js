// Define Configuration

var config = {
    keys: [  // Authentication keys
        "12345",
        "67890"
    ],

    ips: [  //IP's
        "*.*.*.*"
    ],
    ssl: { //SLL set key and cert to absolute path if SSL used, false if not
        key: false,
        cert: false
    },

    port: 8080,
    base: "/tmp",  //directory
    cmode: "0755"  // Default create mode
};

var fs = require("fs-extra"),
    restify = require("restify"),
    md5File = require('md5-file'),
    server;

if (config.ssl.key && config.ssl.cert) { // Determine if SSL is used
    var https = { // Get CERT
        certificate: fs.readFileSync(config.ssl.cert),
        key: fs.readFileSync(config.ssl.key)
    };

    server = restify.createServer({  // Config server with SSL
        name: "fsapi",
        certificate: https.certificate,
        key: https.key
    });
} else {
    server = restify.createServer({  // Config non-SSL Server
        name: "fsapi"
    });
}

server.use(restify.acceptParser(server.acceptable)); // Additional server config
server.use(restify.queryParser());
server.use(restify.bodyParser());
server.use(restify.CORS());


// Regular Expressions
var commandRegEx = /^\/([a-zA-Z0-9_\.~-]+)\/([a-zA-Z0-9_\.~-]+)\/(.*)/,  // /{key}/{command}/{path}
    pathRegEx = /^\/([a-zA-Z0-9_\.~-]+)\/(.*)/;  // /{key}/{path}


function unknownMethodHandler(req, res) { //UnknownMethod handler
    if (req.method.toLowerCase() === 'options') {
        var allowHeaders = ['Accept', 'Accept-Version', 'Content-Type', 'Api-Version', 'Origin', 'X-Requested-With']; // added Origin & X-Requested-With

        if (res.methods.indexOf('OPTIONS') === -1) res.methods.push('OPTIONS');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.header('Access-Control-Allow-Origin', req.headers.origin);
        return res.send(204);
    } 
    else return res.send(new restify.MethodNotAllowedError());
}
server.on('MethodNotAllowed', unknownMethodHandler);


var checkKey = function (config, req) { //Check Key (Called by checkReq)
    // Loop through keys in config
    for (var i = 0, z = config.keys.length; i < z; i++) {
        if (config.keys[i] === req.params[0]) {
            return true;
        }
    }
    return false;
};

var checkIP = function (config, req) {    //Check IP (Called by checkReq)
    var ip = req.connection.remoteAddress.split("."),
        curIP,
        b,
        block = [];
    for (var i=0, z=config.ips.length-1; i<=z; i++) {
        curIP = config.ips[i].split(".");
        b = 0;
        // Compare each block
        while (b<=3) {
            (curIP[b]===ip[b] || curIP[b]==="*") ? block[b] = true : block[b] = false;
            b++;
        }
        // Check all blocks
        if (block[0] && block[1] && block[2] && block[3]) {
            return true;
        }
    }
    return false;
};

var checkReq = function (config, req, res) {  // * Check Request: Checks Key and IP Address
    res.header('Access-Control-Allow-Origin', '*');  // Set access control headers
    if(!checkKey(config, req) || !checkIP(config, req)) {    // Check key and IP
        res.send(401);
        return false;
    }
    return true;
};

var resError = function (code, raw, res) { //Response Error
    var codes = {
        100: "Unknown command",
        101: "Could not list files",
        102: "Could not read file",
        103: "Path does not exist",
        104: "Could not create copy",
        105: "File does not exist",
        106: "Not a file",
        107: "Could not write to file",
        108: "Could not delete object"
    };

    res.send({ "status": "error", "code": code, "message": codes[code], "raw": raw });
    return false;

};


var resSuccess = function (data, res) {
    res.send({ "status": "success", "data": data }); // Response Success
};

var merge = function (obj1,obj2) { //Merge function
    var mobj = {},
        attrname;
    for (attrname in obj1) { mobj[attrname] = obj1[attrname]; }
    for (attrname in obj2) { mobj[attrname] = obj2[attrname]; }
    return mobj;
};


var getBasePath = function (path) { //Get Base Path
    var base_path = path.split("/");

    base_path.pop(); 
    return base_path.join("/");
};

var checkPath = function (path) { //Check Path
    var base_path = getBasePath(path);
    return fs.existsSync(base_path);
};

//GET (Read)
//Commands:  () dir - list contents of directory;    () file - return content of a file
server.get(commandRegEx, function (req, res, next) {
    
    checkReq(config, req, res); // Check request
    var path = config.base + "/" + req.params[2]; // Set path

        switch (req.params[1]) {
        // List contents of directory
        case "dir":
            fs.readdir(path, function (err, files) {
                if (err) {
                    resError(101, err, res);
                } else {

                    // Ensure ending slash on path
                    (path.slice(-1)!=="/") ? path = path + "/" : path = path;

                    var output = {},
                        output_dirs = {},
                        output_files = {},
                        current,
                        relpath,
                        link;

                    // Function to build item for output objects
                    var createItem = function (current, relpath, type, link) {
                        return {
                            path: relpath.replace('//','/'),
                            type: type,
                            size: fs.lstatSync(current).size,
                            atime: fs.lstatSync(current).atime.getTime(),
                            mtime: fs.lstatSync(current).mtime.getTime(),
                            link: link
                        };
                    };
                    files.sort(); // Sort ASCII

                    // Loop through and create two objects
                    // 1. Directories
                    // 2. Files
                    for (var i=0, z=files.length-1; i<=z; i++) {
                        current = path + files[i];
                        relpath = current.replace(config.base,"");
                        (fs.lstatSync(current).isSymbolicLink()) ? link = true : link = false;
                        if (fs.lstatSync(current).isDirectory()) {
                            output_dirs[files[i]] = createItem(current,relpath,"directory",link);
                        } else {
                            output_files[files[i]] = createItem(current,relpath,"file",link);
                        }
                    }

                    // Merge so we end up with alphabetical directories, then files
                    output = merge(output_dirs,output_files);

                    // Send output
                    resSuccess(output, res);
                }
            });
            break;

        // Return contents of requested file
        case "file":
            fs.readFile(path, function (err, data) {
                if (err)  { resError(102, err, res);} 
                else {
                    res.writeHead(200, {
                    'Content-Disposition': 'attachment; filename=' + req.params[2]
                    });
                res.end(data);
            }
        });
        break;

        default:
            resError(100, null, res);   // Unknown command
        }


    return next();
});

//POST (Create)
// Commands:  () dir - creates a new directory;   () file - creates a new file;  () copy - copies a file or dirextory (to path at param "destination")
server.post(commandRegEx, function (req, res, next) {
    checkReq(config, req, res);
    var path = config.base + "/" + req.params[2];

    switch (req.params[1]) {
        case "dir": // Creates a new directory

            if (checkPath(path)) {
                fs.mkdir(path, config.cmode, function () {
                    resSuccess(null, res);
                });
            } else {
                resError(103, null, res);
            }
            break;

        case "file": // Creates a new file
            if (checkPath(path)) {
                if (req.params.data) {
                fs.writeFile(path, req.params.data, function(err) {
                    if(err) {
                        resError(107, err, res);
                    } else {
                        resSuccess(null, res);
                    }
                });
            }else if (req.files && req.files.filedata) {
                fs.readFile(req.files.filedata.path, function (err, data) {
                    fs.writeFile(path, data, function (err) {
                        if(err) {
                            resError(107, err, res);
                        } else {
                            var hash = md5File.sync(path)
                            resSuccess(hash, res);
                        }
                    });
                });
                } else {

                // No file attached, Base path exists, create empty file
                fs.openSync(path, "w");
                resSuccess(null, res);
                resError(106, null, res);
                }
            } else {
                // Bad base path
                resError(103, null, res);
            }
            break;

        // Copies a file or directory
        // Supply destination as full path with file or folder name at end
        // Ex: http://yourserver.com/{key}/copy/folder_a/somefile.txt, destination: /folder_b/somefile.txt
        case "copy":
            var destination = config.base + "/" + req.params.destination;
            if (checkPath(path) && checkPath(destination)) {
                fs.copy(path, destination, function(err){
                    if (err) {
                        resError(104, err, res);
                    }
                    else {
                        resSuccess(null, res);
                    }
                });
            } else { resError(103, null, res); // Bad base path
            }
            break;

        default:
            // Unknown command
            resError(100, null, res);
    }

    return next();
});

//PUT (Update)
//Commands: ()rename - renames a file or folder (using param "name");  () save - saves contents to a file (using param "data")
server.put(commandRegEx, function (req, res, next) {
    checkReq(config, req, res);
    var path = config.base + "/" + req.params[2];

    switch (req.params[1]) {
        
        case "rename": // Rename a file or directory
            var base_path = getBasePath(path);
            fs.rename(path,base_path + "/" + req.params.name, function () {
                resSuccess(null, res);
            });

            break;

        case "file": // Saves updates to a file
            if (fs.existsSync(path)) { //exist test
                if (!fs.lstatSync(path).isDirectory()) { //makeking sure is a file
                    if (req.params.data) { //write
                        fs.writeFile(path, req.params.data, function(err) {
                            if(err) {
                                resError(107, err, res);
                            } 
                            else { resSuccess(null, res);}
                            })
                            ;
                    } else if (req.files && req.files.filedata) {
                        fs.readFile(req.files.filedata.path, function (err, data) {
                            fs.writeFile(path, data, function (err) {
                            if(err) {
                                resError(107, err, res);
                            } else {
                                var hash = md5File.sync(path)
                                resSuccess(hash, res);
                            }
                            });
                        });
                    } 
                    else { resError(106, null, res) }
                } else {
                    resError(106, null, res);
                }
            } else {
                resError(105, null, res);
            }

            break;


        default:
            // Unknown command
            resError(100, null, res);
    }

    return next();

});

// DELETE
server.del(pathRegEx, function (req, res, next) {
    checkReq(config, req, res);
    var path = config.base + "/" + req.params[1];
    if (fs.existsSync(path)) {
        fs.remove(path, function (err) {  // Remove file or directory
            if (err) {
                resError(108, err, res);
            } else {
                resSuccess(null, res);
            }
        });
    } else {
        resError(103, null, res);
    }

    return next();

});

//START SERVER
server.listen(config.port, function () {
    console.log("%s listening at %s", server.name, server.url);
});
