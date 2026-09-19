-- MeetNote Toggle — double-click to start/stop the local MeetNote server.
-- Always shows a clear ON/OFF status dialog after acting, so a single click
-- both performs the action and confirms the resulting state.
--
-- Starts the server as a launchd job (`launchctl submit`) rather than a
-- plain backgrounded shell command: a `do shell script "... &"` child can
-- get reaped along with the calling app's process group once the script
-- returns, so the server would die right after the "ON" dialog closed.
-- launchd manages the job independently of this app's lifetime.

property appURL : "http://127.0.0.1:8765"
property jobLabel : "com.meetnote.local"
-- This toggle app is compiled to the Desktop as a standalone shortcut, not
-- bundled inside the project folder, so the project path can't be derived
-- from `path to me` — it's fixed to where the repo was cloned.
property projectDirectory : "/Users/hieutt/Vibe Code/Other tools/MeetNote"
-- GUI double-click launches with a minimal PATH (no Homebrew, no nvm), unlike
-- a Terminal shell. Every shell command below explicitly prepends the common
-- Node install locations so `node`/`curl` resolve regardless of how this
-- app was started.
property shellPath : "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

on run
	try
		set logPath to projectDirectory & "/storage/meetnote-server.log"

		if my serverIsReady() then
			my stopServer()
			delay 0.3
			if my serverIsReady() then
				display dialog "Không thể tắt MeetNote. Kiểm tra log tại storage/meetnote-server.log." with title "MeetNote AI" with icon caution buttons {"OK"} default button "OK"
			else
				display dialog "🔴 ĐÃ TẮT" & return & return & "MeetNote server đã dừng." with title "MeetNote AI" with icon note buttons {"OK"} default button "OK" giving up after 3
			end if
		else
			set nodeExecutable to do shell script "PATH=" & quoted form of shellPath & " /usr/bin/which node"
			do shell script "/bin/launchctl remove " & jobLabel & " >/dev/null 2>&1; exit 0"
			set innerCommand to "cd " & quoted form of projectDirectory & " && exec " & quoted form of nodeExecutable & " server.js >> " & quoted form of logPath & " 2>&1"
			do shell script "/bin/launchctl submit -l " & jobLabel & " -- /bin/sh -c " & quoted form of innerCommand

			repeat 60 times
				delay 0.25
				if my serverIsReady() then exit repeat
			end repeat

			if my serverIsReady() then
				display dialog "🟢 ĐÃ BẬT" & return & return & "MeetNote đang chạy tại:" & return & appURL with title "MeetNote AI" with icon note buttons {"OK"} default button "OK" giving up after 3
				open location appURL
			else
				display dialog "Không thể khởi động MeetNote." & return & "Kiểm tra log tại storage/meetnote-server.log." with title "MeetNote AI" with icon caution buttons {"OK"} default button "OK"
			end if
		end if
	on error errMsg
		display dialog "Lỗi MeetNote Toggle:" & return & errMsg with title "MeetNote AI" with icon caution buttons {"OK"} default button "OK"
	end try
end run

on serverIsReady()
	try
		do shell script "PATH=" & quoted form of shellPath & " /usr/bin/curl --fail --silent --max-time 1 " & quoted form of appURL & " >/dev/null"
		return true
	on error
		return false
	end try
end serverIsReady

on stopServer()
	-- The server may be running as a launchd job we started (normal case),
	-- OR as a plain process started some other way (e.g. `npm start` by hand
	-- in a terminal). `launchctl remove` only stops the former, so it's
	-- always paired with a port-based kill to cover the latter too —
	-- otherwise Stop silently does nothing and the toggle loops on "still
	-- running" forever.
	try
		do shell script "/bin/launchctl remove " & jobLabel & " >/dev/null 2>&1; exit 0"
	end try
	try
		do shell script "PATH=" & quoted form of shellPath & " /usr/bin/lsof -ti tcp:8765 | xargs -r kill -9"
	end try
end stopServer
