'use strict';
const {measure}=require('./storage-guardian'),{inventory}=require('./checkpoint-retention');
const MiB=1024*1024;
function policy(cfg){const p={quota:Number(cfg.storageQuotaMiB??4096),reserve:Number(cfg.storageReserveMiB??512),job:Number(cfg.storageJobReserveMiB??320),keep:Number(cfg.storageKeepDays??30)};if(!Object.values(p).every(Number.isSafeInteger)||p.quota<512||p.quota>1048576||p.reserve<128||p.reserve>p.quota||p.job<320||p.job>4096||p.keep<30||p.keep>3650)throw Error('Storage policy needs quota 512–1048576 MiB, reserve 128 MiB or more, job reserve 320–4096 MiB and recovery 30–3650 days.');return p;}
function check(home,cfg,{jobId=null,neededBytes=0,sample=measure(home.root)}={}){
 const p=policy(cfg);if(!Number.isSafeInteger(neededBytes)||neededBytes<0)throw Error('Invalid storage reservation.');
 if(!sample.coverage.complete||!Number.isSafeInteger(sample.freeBytes))throw Error('Storage coverage or free space is unknown. New work refused; inspect Storage Guardian.');
 const jobs=inventory(home).jobs;let reservedBytes=0;
 for(const j of jobs)if(j.id!==jobId&&['queued','running','retrying'].includes(j.status)){const n=j.storageReservationBytes;if(!Number.isSafeInteger(n)||n<0)throw Error('An active legacy job has no storage reservation. Stop and inspect it before new work.');reservedBytes+=n;}
 const recoveryReserveBytes=p.reserve*MiB;
 if(sample.logicalBytes+reservedBytes+neededBytes+recoveryReserveBytes>p.quota*MiB||sample.freeBytes<reservedBytes+neededBytes+recoveryReserveBytes)throw Error('Storage quota or free-disk headroom is insufficient. Existing recovery retained. Inspect category usage and explicitly release eligible recovery or change storage location.');
 return {reservedBytes,neededBytes,recoveryReserveBytes,managedBytes:sample.logicalBytes,quotaBytes:p.quota*MiB};
}
function reserve(home,cfg){if(cfg.storageQuotaMiB===undefined)return null;const bytes=policy(cfg).job*MiB;check(home,cfg,{neededBytes:bytes});return bytes;}
module.exports={policy,check,reserve};
