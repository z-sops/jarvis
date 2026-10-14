'use strict';
const fs=require('fs'),path=require('path');
// Docker reads an actual host file, never Electron's virtual ASAR filesystem.
function runtimePath(dir=__dirname){
  const logical=path.join(dir,'native-container-runner.js');
  const physical=logical.replace(/([\\/])app\.asar([\\/])/,'$1app.asar.unpacked$2');
  const st=fs.lstatSync(physical);
  if(!st.isFile()||st.isSymbolicLink())throw Error('Native runtime package helper is missing or linked.');
  return physical;
}
module.exports={runtimePath};
