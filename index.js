#!/usr/bin/env node
var fs = require('fs-extra');
var program = require('commander');
var AdmZip = require('adm-zip');
var git = require("git-promise");
var _ = require('lodash');
var metadata = require('./lib/metadata.json');
var async = require('async');
var path  = require('path');
var swig  = require('swig');
//var exec = require('child_process').exec;

var localAnt = path.resolve(__dirname, './ant');

program
 .arguments('<commit> <commit>')
 .option('-t, --test', 'Only run test methods')
 .option('-api, --apiversion <API Version>', 'API version')
 .action(function(one, two) {
    var diff = 'diff --name-only $(git merge-base ' + one + ' ' + two + ') ' + two;

    git(diff).then(function(stdout) {
      var sfdcFilePaths = [];
      var fileNames = _.split(stdout, /\r?\n/);

      fileNames.forEach(function(name) {
        name = _.trim(name);
        if (/\.cls$|\.trigger$|\.page$|\.component$/.test(name)) {
          sfdcFilePaths.push(name);
          sfdcFilePaths.push(name + '-meta.xml'); // Add the realted xml file path
        }
      });
      console.log('Run ciforce');
      createDeployZip(sfdcFilePaths);
      getTestMethodClasses(sfdcFilePaths);
    });
 })
 .parse(process.argv);

var getTestMethodClasses = function(files) {
  var result = [];
  var reg = /^\s*@istest|\s+testmethod\s+/img;

  async.each(files, function(file, callback) {
    if (file.endsWith('.cls')) {
      fs.readFile(file, 'utf8', function(err, data) {
        if (reg.test(data)) {
          result.push(file.replace(/.*\/|\..*$/g, ''));
        }
        callback();
      });
    } else {
      callback();
    }
  }, function(err) {
    console.log('Run test methods: ' + result);
    createAntBuildXml(result);
    return result;
  });
};

var createDeployZip = function(files) {
  async.each(files, function(file, callback) {
    var dest = 'build/tmp/' + file.replace(/\w*\//, ''); // remove the top level folder

    fs.copy(file, dest, function(err) {
      callback();
    });
  }, function(err) {
    var zip = new AdmZip();
    var pkg = getSuffixsToMetadataFileNames(files);
    var packageXml = buildPackageXml(pkg, '34.0');

    zip.addFile('package.xml', new Buffer(packageXml));

    zip.addLocalFolder('build/tmp/');
    zip.writeZip('build/deploy.zip');
    console.log(packageXml);
  });
}

var getVersionFromPackageXml = function() {
  return '34.0';
}

/*
 * {
  '.cls' : [
    'HomeController'
  ],
  '.page': [
    'Home'
  ]
 }
 */
var getSuffixsToMetadataFileNames = function(metadataPaths) {
  var result = {};

  metadataPaths.forEach(function(path) {
    if (_.endsWith(path, '-meta.xml')) {
      return; // skip the meta.xml file
    };

    var names = [];
    var fileName = path.replace(/.*\/|\..*$/g, '');
    var suffix = '.' + path.split('.').pop();

    if (result[suffix] !== undefined) {
      names = result[suffix];
    }
    try {
      fs.accessSync(path, fs.F_OK) // ensure file exists in src folder
      names.push(fileName);
      result[suffix] = names;
    } catch (e) {}
  });

  return result;
}

var buildPackageXml = function(pkg, version, pkgName) {
  var packageXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">'
  ];
  if(pkgName) {
    packageXml.push('    <fullName>' + pkgName + '</fullName>');
  }
  if(pkg) {
    Object.keys(pkg).forEach(function(key) {
      var type = pkg[key];
      var typeName = lookupMetadata(key);

      if(!typeName) { grunt.fail.fatal(key + ' is not a valid metadata type'); }

      packageXml.push('    <types>');
      type.forEach(function(t) {
        packageXml.push('        <members>' + t + '</members>');
      });
      packageXml.push('        <name>' + typeName + '</name>');
      packageXml.push('    </types>');
    });
  }
  packageXml.push('    <version>' + version + '</version>');
  packageXml.push('</Package>');
  return packageXml.join('\n');
}

var lookupMetadata = function (key) {
  key = key.toLowerCase();
  var typeName;
  // try to match on metadata type
  if(metadata[key] && metadata[key].xmlType) {
    typeName = metadata[key].xmlType;
  } else {
    // try to match on folder
    Object.keys(metadata).forEach(function(mk) {
      var folder = metadata[mk].folder;
      if(typeof folder === 'string' && folder.toLowerCase() === key) {
        typeName = metadata[mk].xmlType;
      } else if(key === 'documents') {
        typeName = metadata['document'].xmlType;
      } else if(key === 'emails') {
        typeName = metadata['email'].xmlType;
      } else if(key === 'reports') {
        typeName = metadata['report'].xmlType;
      } else if(key === 'dashboards') {
        typeName = metadata['dashboard'].xmlType;
      }
    });
  }
  return typeName;
}

function createAntBuildXml (testMethods) {
  var options = {
    user: '${sf.username}',
    pass: '${sf.password}',
    token: false,
    sessionid: false,
    root: './build',
    apiVersion: '29.0',
    serverurl: '${sf.serverurl}',
    pollWaitMillis: 10000,
    maxPoll: 20,
    checkOnly: true,
    runAllTests: false,
    rollbackOnError: true,
    useEnv: false,
    existingPackage: false,
    zipFile: 'deploy.zip',
    testLevel: 'RunSpecifiedTests',
    tests: []
  };

  options['tests'] = testMethods;

  fs.writeFile('build/build.xml',
    swig.renderFile(path.join(localAnt,'/antdeploy.build.xml'), options),
    function(err) {
      //console.log(err);
  });
}

function runAnt(task, target, done) {
  var args =  [
    '-buildfile',
    path.join(localTmp,'/ant/build.xml'),
    '-lib',
    localLib,
    '-Dbasedir='     + process.cwd()
  ];
}
