/* NewsDork Cast — free Google Cast support via the Default Media Receiver (no registration, no server).
   The Archive only serves clips up to ~6 minutes, so a broadcast is sent to the TV as a queue of 6-minute clips. */
(function(){'use strict';
const SEG=360;
const okOrigin=location.protocol==='https:'||/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const C={ready:false,active:false,ctx:null,player:null,ctl:null,job:null,base:0,lastT:0};
window.NDCast=C;
const clip=(j,s)=>`https://archive.org/download/${j.id}/${encodeURIComponent(j.file)}?exact=1&start=${s}&end=${Math.min(s+SEG,Math.ceil(j.duration))}`;
C.time=()=>{if(!C.player)return C.lastT;const m=C.session()?.getMediaSession();const idx=m&&m.items?m.items.findIndex(i=>i.itemId===m.currentItemId):-1;
 const base=idx>=0&&m.items[idx].customData?m.items[idx].customData.start:C.base;return C.lastT=base+(C.player.currentTime||0)};
C.session=()=>C.ctx&&C.ctx.getCurrentSession();
C.load=(job,startAt)=>{const s=C.session();if(!s)return;C.job=job;startAt=Math.max(0,Math.min(startAt||0,job.duration-2));
 const items=[];for(let st=0;st<job.duration;st+=SEG){const mi=new chrome.cast.media.MediaInfo(clip(job,st),'video/mp4');mi.streamType=chrome.cast.media.StreamType.BUFFERED;
  const md=new chrome.cast.media.GenericMediaMetadata();md.title=job.title;md.subtitle=`${job.network} · ${job.when}`;md.images=[new chrome.cast.Image(job.thumb(st+60))];mi.metadata=md;
  const it=new chrome.cast.media.QueueItem(mi);it.autoplay=true;it.preloadTime=20;it.customData={start:st};items.push(it)}
 const idx=Math.floor(startAt/SEG);C.base=idx*SEG;
 const req=new chrome.cast.media.QueueLoadRequest(items);req.startIndex=idx;req.repeatMode=chrome.cast.media.RepeatMode.OFF;
 items[idx].startTime=startAt-idx*SEG;
 s.getSessionObj().queueLoad(req,()=>C.on.status('Playing on TV'),e=>C.on.status('The TV couldn’t load this broadcast ('+(e&&e.code||'error')+').'))};
C.seek=t=>{if(!C.job)return;const cur=Math.floor(C.time()/SEG),to=Math.floor(t/SEG);
 if(cur===to&&C.player){C.player.currentTime=t-to*SEG;C.ctl.seek()}else C.load(C.job,t)};
C.toggle=()=>C.ctl&&C.ctl.playOrPause();
C.setVolume=(v,m)=>{if(!C.ctl)return;C.player.volumeLevel=v;C.ctl.setVolumeLevel();if(C.player.isMuted!==m)C.ctl.muteOrUnmute()};
C.stop=()=>C.ctx&&C.ctx.endCurrentSession(true);
C.on={start(){},end(){},status(){},state(){}};
window.__onGCastApiAvailable=ok=>{if(!ok)return;
 C.ctx=cast.framework.CastContext.getInstance();
 C.ctx.setOptions({receiverApplicationId:chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,autoJoinPolicy:chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED});
 C.player=new cast.framework.RemotePlayer();C.ctl=new cast.framework.RemotePlayerController(C.player);C.ready=true;
 const E=cast.framework.RemotePlayerEventType;
 C.ctl.addEventListener(E.IS_CONNECTED_CHANGED,()=>{if(C.player.isConnected){C.active=true;C.on.start(C.session()?.getCastDevice()?.friendlyName||'your TV')}else if(C.active){C.active=false;C.on.end(C.lastT)}});
 C.ctl.addEventListener(E.IS_PAUSED_CHANGED,()=>C.on.state(!C.player.isPaused));
 C.ctl.addEventListener(E.PLAYER_STATE_CHANGED,()=>{const s=C.player.playerState;if(s==='BUFFERING')C.on.status('Buffering on TV…');else if(s==='PLAYING')C.on.status('Playing on TV');else if(s==='PAUSED')C.on.status('Paused');else if(s==='IDLE'&&C.job&&C.time()>=C.job.duration-SEG)C.on.status('Finished')});
 C.on.ready&&C.on.ready()};
if(okOrigin){const sc=document.createElement('script');sc.src='https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';sc.async=true;document.head.appendChild(sc)}
})();
