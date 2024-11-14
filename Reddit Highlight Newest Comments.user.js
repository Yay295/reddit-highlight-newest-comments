// ==UserScript==
// @name          Reddit highlight newest comments
// @description   Highlights new comments in a thread since your last visit
// @namespace     https://greasyfork.org/users/98-jonnyrobbie
// @author        JonnyRobbie and Yay295
// @include       /https?:\/\/((www|old|pay|[a-z]{2})\.)?reddit\.com\/r\/[a-zA-Z0-9_-]+\/comments\/.*/
// @grant         none
// @version       1.10.0
// ==/UserScript==

"use strict";

/*-----settings-----*/
const expiration = 30 * 7 * 24 * 60 * 60 * 1000;   // expiration time in milliseconds
const betterChildStyle = "3px solid #9AE";         // border of said comment
/*-----settings-----*/

// times in milliseconds
const now = Date.now();
const oneMinute = 60 * 1000;
const oneHour = 60 * oneMinute;
const oneDay = 24 * oneHour;
const oneWeek = 7 * oneDay;
const timeZoneOffset = new Date().getTimezoneOffset() * 60000;

// most recent comment time
let mostRecentTime = 0;

// array of mutation observers
let observers = [];
let initComplete = false;
let moreCommentsButtons = document.getElementsByClassName("morecomments");

// adds a task while avoiding the 4ms delay from setTimeout
let addTask = (function() {
	let timeouts = [], channel = new MessageChannel();
	channel.port1.onmessage = evt => timeouts.length > 0 ? timeouts.shift()() : null;
	return func => channel.port2.postMessage(timeouts.push(func));
})();


function purgeOldStorage() {
	console.log("clearing old localStorage entries");

	let total = 0;
	for (let key in localStorage) {
		if (key.indexOf("redd_id_") == 0) {
			const times = JSON.parse(localStorage.getItem(key));
			if (times[times.length-1] + expiration < now) {
				localStorage.removeItem(key);
				++total;
			}
		}
	}

	if (total == 1) console.log("1 localStorage entry older than " + expiration + "ms has been removed");
	else console.log(total + " localStorage entries older than " + expiration + "ms have been removed");
}

// updates localStorage and returns the last time visited
function updateStorage(threadID) {
	if (!localStorage.hasOwnProperty(threadID)) {
		console.log("thread has not been visited before");
		localStorage.setItem(threadID, "[" + now + "]");
		return now;
	} else {
		let times = JSON.parse(localStorage.getItem(threadID));
		times.push(now);
		localStorage.setItem(threadID, JSON.stringify(times.slice(-5)));
		return times[times.length-2];
	}
}


// converts the time difference to a nice string
function prettify(time) {
	if (time == 0) return "no highlighting";

	let timeString = "", difference = now - time;

	if (difference > oneDay) {
		const days = (difference / oneDay) | 0;
		timeString += days + " day" + (days > 1 ? "s" : "");
		difference -= days * oneDay;
	}
	if (difference > oneHour) {
		const hours = (difference / oneHour) | 0;
		timeString += (timeString ? ", " : "") + hours + " hour" + (hours > 1 ? "s" : "");
		difference -= hours * oneHour;
	}
	if (difference > oneMinute) {
		const minutes = (difference / oneMinute) | 0;
		timeString += (timeString ? ", " : "") + minutes + " minute" + (minutes > 1 ? "s" : "");
		difference -= minutes * oneMinute;
	}

	return (timeString || difference + "ms") + " ago";
}

function updateMostRecentComment() {
	let mostRecentSpan = document.getElementById("most-recent-comment");
	if (mostRecentSpan) {
		if (mostRecentTime === 0) {
			mostRecentSpan.innerText = "";
		} else {
			let timestring = prettify(mostRecentTime).replace(/(.*),/,"$1, and").replace(/^([^,]*),( and[^,]*)$/,"$1$2");
			let timestamp = new Date(mostRecentTime-timeZoneOffset).toISOString().replace("T"," ").replace(/\..+/,"");
			mostRecentSpan.innerText = "The most recent comment was made/edited " + timestring + " at " + timestamp + ".";
		}
	}
}

// event callback to do the comment highlighting
function highlightNewComments(event) {
	// Highlighting is applied to `.new-comment .usertext-body`,
	// so one "new-comment" will affect all of its children.

	function removeHighlighting(event) {
		event.stopPropagation();
		event.currentTarget.parentElement.parentElement.parentElement.classList.remove("new-comment");
		event.currentTarget.classList.remove("usertext-body");
	}

	const rootNode = event.detail || document.body;
	const time = parseInt(event.currentTarget.value,10);

	if (time) {
		console.log("highlighting comments from " + prettify(time));

		let comments = Array.from(rootNode.getElementsByClassName("comment"));

		// remove highlighting
		for (let comment of comments) {
			comment.classList.remove("new-comment");
			let cc = comment.querySelector(":scope > .entry > form > div");
			if (cc) cc.classList.add("usertext-body");
		}

		// add highlighting
		for (let comment of comments) {
			if (comment.classList.contains("deleted")) continue;

			// the first element is the post time, the second element is the edit time
			const timeElements = comment.children[2].getElementsByTagName("time");
			const ctime = Date.parse(timeElements[timeElements.length-1].getAttribute("datetime"));
			if (ctime > time) comment.classList.add("new-comment");
			if (ctime > mostRecentTime) mostRecentTime = ctime;

			comment.querySelector(":scope > .entry > form > div").addEventListener("click",removeHighlighting);
		}
	} else {
		// we need to check every comment because a comment can have an edit date more recent than its replies
		let comments = Array.from(rootNode.getElementsByClassName("comment"));
		for (let comment of comments) {
			if (comment.classList.contains("deleted")) continue;

			// the first element is the post time, the second element is the edit time
			const timeElements = comment.children[2].getElementsByTagName("time");
			const ctime = Date.parse(timeElements[timeElements.length-1].getAttribute("datetime"));
			if (ctime > mostRecentTime) mostRecentTime = ctime;
		}
	}

	updateMostRecentComment();

	if (time || !initComplete) { // re-apply highlighting when more comments are loaded
		for (let observer of observers) observer.disconnect();
		observers = [];
		for (let more of moreCommentsButtons) {
			let container = more.parentElement.parentElement.parentElement;
			let observer = new MutationObserver(mutations => document.getElementById("comment-visits").dispatchEvent(new CustomEvent("change",{detail:container})));
			observer.observe(container,{childList:true});
			observers.push(observer);
		}
	}

	if (time && initComplete) hideReadComments(rootNode);
	if (time == 0) { // uncollapse all comments and remove highlighting
		let selector = (rootNode == document.body ? "" : ".clearleft + .clearleft ~ ") + ".collapsed > div > p > a.expand";
		let collapsed = rootNode.querySelectorAll(selector);
		for (let comment of collapsed) comment.click();
		let newComments = rootNode.querySelectorAll(".new-comment");
		for (let comment of newComments) comment.classList.remove("new-comment");
	}
}


// add selector to choose how long ago to highlight comments from (includes function to highlight comments)
function addTimeSelector(times) {
	let commentarea = document.getElementsByClassName("commentarea")[0];
	let commentContainer = commentarea.querySelector(":scope > div.sitetable");

	let timeSelect = document.createElement("div");
		timeSelect.className = "rounded gold-accent comment-visits-box";

	let timeSelectMostRecent = document.createElement("span");
		timeSelectMostRecent.id = "most-recent-comment";

	let timeSelectTitle = document.createElement("div");
		timeSelectTitle.className = "title";
		timeSelectTitle.innerHTML = "Highlight comments posted since previous visit: ";

	let timeSelectSelect = document.createElement("select");
		timeSelectSelect.id = "comment-visits";
		timeSelectSelect.addEventListener("change",highlightNewComments);

	for (let time of times) {
		let option = document.createElement("option");
			option.value = time;
			option.innerHTML = prettify(time);
		timeSelectSelect.appendChild(option);
	}

	timeSelectTitle.appendChild(timeSelectSelect);
	timeSelect.appendChild(timeSelectTitle);
	timeSelect.appendChild(timeSelectMostRecent);
	commentarea.insertBefore(timeSelect,commentContainer);

	return timeSelectSelect;
}

function addLoadAllCommentsButton() {
	let btn = document.createElement("button");

	let wasLoading = false;
	function callback() {
		// These replies are just hidden using CSS, so we don't have
		// to wait for them to be downloaded from the server.
		let showRepliesButtons = document.querySelectorAll(".showreplies");
		for (let showRepliesButton of showRepliesButtons) {
			showRepliesButton.click();
		}

		if (moreCommentsButtons.length) {
			let isLoading = moreCommentsButtons[0].textContent == "loading...";

			if (!isLoading || wasLoading)
				moreCommentsButtons[0].firstElementChild.click();

			if (isLoading && wasLoading)
				setTimeout(callback,500);
			else addTask(callback);

			wasLoading = isLoading;
		} else {
			btn.remove();
			alert("done loading all comments");
		}
	}

	btn.innerHTML = "load all comments";
	btn.style.margin = "0px 5px 15px";
	btn.style.padding = "7px 10px 7px 7px";
	btn.addEventListener("click",callback);

	let commentarea = document.getElementsByClassName("commentarea")[0];
	let commentContainer = commentarea.querySelector(":scope > div.sitetable");
	commentarea.insertBefore(btn,commentContainer);
}

// highlight child comment if it has better karma than its parent
function highlightBetterChild(comment) {
	let scoreTag = comment.getElementsByClassName("tagline")[0].getElementsByClassName("unvoted");
	let scorechild = scoreTag.length ? parseInt(scoreTag[0].innerHTML) : 0;
	scoreTag = comment.parentNode.parentNode.parentNode.getElementsByClassName("tagline")[0].getElementsByClassName("unvoted");
	let scoreparent = scoreTag.length ? parseInt(scoreTag[0].innerHTML) : 0;

	let voted = comment.getElementsByClassName("midcol")[0].className;
	if (voted == "midcol likes") ++scorechild;
	else if (voted == "midcol dislikes") --scorechild;

	voted = comment.parentNode.parentNode.parentNode.getElementsByClassName("midcol")[0].className;
	if (voted == "midcol likes") ++scoreparent;
	else if (voted == "midcol dislikes") --scoreparent;

	if (scoreparent < scorechild && comment.parentNode.parentNode.parentNode.className != "content")
		comment.style.setProperty("border-left", betterChildStyle, "important");
}

// hides comments you've already seen that don't have any unread children
function hideReadComments(rootNode) {
	console.log("hiding already-read comments");

	let count = 0;
	// The root node is changed and added after everything else so that we
	// don't accidentally grab comments that have been manually collapsed.
	let comments = Array.from(rootNode.getElementsByClassName("comment")).reverse();
	rootNode = rootNode.parentElement.closest(".comment") || rootNode;
	if (rootNode.classList.contains("comment")) comments.push(rootNode);

	while (true) {
		for (let comment of comments) {
			// comment is collapsed
			if (comment.classList.contains("collapsed")) {
				if (rootNode == document.body) // and we aren't loading more comments
					comment.querySelector(".expand").click(); // uncollapse it
				else continue; // otherwise skip it
			}

			// comment is new
			if (comment.classList.contains("new-comment")) continue;

			// comment has a new reply (not necessarily a direct reply) that is not collapsed
			let newReply = comment.querySelector(".comment.new-comment:not(.collapsed)");
			if (newReply) {
				// if this is a direct reply
				if (newReply.parentElement.closest(".comment") == comment) continue;

				// otherwise check all of the comments between the comment and the reply to see if they are collapsed
				do { newReply = newReply.parentElement.closest(".comment");
				} while (newReply != comment && !newReply.classList.contains("collapsed"));

				// if none of them were collapsed
				if (newReply == comment) continue;
			}

			// comment has replies (not necessarily direct replies) hidden under a "load more comments" link
			if (comment.querySelector(".morecomments") || document.querySelector(".showreplies")) {
				continue;
			}

			// otherwise
			comment.querySelector(".expand").click(); // hide comment
			++count;
		}

		// if we collapsed everything, check the parent comment
		if (rootNode.classList.contains("collapsed")) {
			rootNode = rootNode.parentElement.closest(".comment");
			if (rootNode) comments = [rootNode];
			else break;
		} else break;
	}

	console.log(count + " comments collapsed");
}


function init() {
	if (document.querySelector('link[rel="shorturl"]')) {
		const url_parts = location.pathname.split('/');
		const threadID = "redd_id_" + url_parts[4] + (url_parts[6] ? '_' + url_parts[6] : '');
		console.log("thread ID: " + threadID);

		console.log("current time: " + now);

		purgeOldStorage();

		const lastVisit = updateStorage(threadID);
		console.log("last visit: " + lastVisit);

		let cv = document.getElementById("comment-visits");
		if (cv !== null) cv.parentElement.parentElement.remove();
		let times = JSON.parse(localStorage.getItem(threadID)).reverse().slice(1);
		times.push(0);
		cv = addTimeSelector(times);
		cv.dispatchEvent(new Event("change"));

		if (moreCommentsButtons.length || document.querySelector(".showreplies")) {
			addLoadAllCommentsButton();
		}

		let comments = document.getElementsByClassName("comment");
		for (let comment of comments) highlightBetterChild(comment);

		if (lastVisit != now) hideReadComments(document.body);

		initComplete = true;
	}
}
addEventListener("load",init);
