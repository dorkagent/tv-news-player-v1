# NewsDork v3

A static, open-source player for the Internet Archive TV News Archive. There's no server, no relay, and no build step. Every request goes from the browser straight to archive.org.

- **Home**: a hero of the newest primetime shows (C-SPAN is excluded because it reruns a lot), plus Continue watching, Just archived, Primetime, Hearings, and Markets rows.
- **Going back**: scrolling loads one earlier day at a time with no end. The day pills and the date picker jump straight to a day.
- **Networks → shows → episodes**: a network page lists its shows. A show page lists every archived episode, newest first, and keeps loading older ones as you scroll.
- **Player**: one continuous MediaSource stream built from 2-minute Archive clips (the fallback is `?engine=segments`). It has captions, a searchable synced transcript, frame previews on the scrub bar, a share link to the current moment, Up next, and resume where you left off.
- **Chromecast (free)**: on https (GitHub Pages) or localhost, a Cast button appears in Chrome. It sends the broadcast to Google's built-in TV player as a queue of 6-minute Archive clips, starting from where you are. Your browser becomes the remote, and stopping the cast resumes playback here. Expect a short hiccup at each clip change, and there are no captions on the TV. A double-clicked local file won't show the button.
- **Keys**: Space (play/pause), ←/→ (back 10s / forward 30s), F (fullscreen), C (captions), T (transcript), M (mute), Esc (back).

`newsdork.html` is the same app in one file, so you can open it by double-clicking.

Support: https://ko-fi.com/heyitsdork · BTC bc1qhdczc6na0s8thuql98g00g74shqsg8nuqrml75
