const messagesDiv = document.getElementById("messages");
const input = document.getElementById("userInput");
const languageSelect = document.getElementById("languageSelect");
let recognizing = false;
let recognition;
let synth = window.speechSynthesis;

// === VOICE INPUT SETUP ===
function toggleVoice() {
  const selectedLang = languageSelect.value;

  if (!recognition) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = function (event) {
      const transcript = event.results[0][0].transcript;
      input.value = transcript;
      sendMessage(); // Auto-send
    };

    recognition.onend = () => {
      recognizing = false;
      document.getElementById("voiceBtn").textContent = "🎤 Speak";
    };
  }

  recognition.lang = selectedLang;

  if (recognizing) {
    recognition.stop();
  } else {
    recognition.start();
    recognizing = true;
    document.getElementById("voiceBtn").textContent = "🛑 Listening...";
  }
}

// === STOP SPEAKING ===
function stopSpeaking() {
  synth.cancel();
}

// === SEND TO BACKEND ===
async function sendMessage() {
  const message = input.value.trim();
  if (!message) return;

  addMessage(message, "user");
  input.value = "";

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    if (data.response) {
      addMessage(data.response, "bot");
      speak(data.response);
    } else {
      addMessage("Something went wrong!", "bot");
    }
  } catch (err) {
    console.error("Error:", err);
    addMessage("Error contacting the agent.", "bot");
  }
}

// === DISPLAY MESSAGE ===
function addMessage(text, sender) {
  const div = document.createElement("div");
  div.className = "msg " + sender;
  div.textContent = `${sender === "user" ? "🧍 You" : "🤖 Bot"}: ${text}`;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// === VOICE OUTPUT ===
function speak(text) {
  stopSpeaking(); // cancel any current speech
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = languageSelect.value || "en-US";
  utterance.rate = 1;
  synth.speak(utterance);
}

// === ENTER TO SEND ===
input.addEventListener("keypress", function (e) {
  if (e.key === "Enter") sendMessage();
});
