'use strict';
// Existing contained diagnostic only: no install, image pull or model request.
const {checkRuntime}=require('../lib/native-containment');
(async()=>{
  for(const engine of ['hermes','opencode']){
    const report=await checkRuntime({nativeContainerImage:process.argv[2]},engine);
    console.log(JSON.stringify({engine,...report},null,2));
    if(!report.ok)process.exitCode=1;
  }
})().catch(()=>{console.error('Contained runtime diagnostic failed; inspect cleanup before retry.');process.exitCode=1;});
