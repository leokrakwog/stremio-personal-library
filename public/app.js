const connect = document.getElementById("connect");
const status = document.getElementById("status");
const result = document.getElementById("result");
const error = document.getElementById("error");
const addonUrlBox = document.getElementById("addonUrl");
const install = document.getElementById("install");
const copy = document.getElementById("copy");

let addonUrl = "";
let busy = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function showError(message) {
  error.textContent = message;
  error.classList.remove("hidden");
  result.classList.add("hidden");
}

connect.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  connect.disabled = true;
  result.classList.add("hidden");
  error.classList.add("hidden");
  status.textContent = "Apro Stremio…";

  // Open synchronously to avoid popup blockers, then navigate the new window.
  const win = window.open("about:blank", "stremioLink");

  try {
    const createResp = await fetch("/api/link/create");
    const created = await createResp.json();
    if (!createResp.ok || !created.link || !created.code) {
      throw new Error(created.error || "Impossibile creare il collegamento Stremio");
    }

    if (win) win.location.href = created.link;
    else status.textContent = "Il browser ha bloccato la finestra: abilita i popup e riprova.";

    status.textContent = "Completa il collegamento nella finestra di Stremio…";

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const readResp = await fetch(`/api/link/read?code=${encodeURIComponent(created.code)}`);
      const payload = await readResp.json();

      if (payload?.result?.success === true && payload?.result?.authKey) {
        status.textContent = "Account collegato. Creo il tuo addon…";

        const connectResp = await fetch("/api/connect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ authKey: payload.result.authKey })
        });
        const connected = await connectResp.json();
        if (!connectResp.ok || !connected.addonUrl) {
          throw new Error(connected.error || "Impossibile creare la sessione Stremio");
        }

        addonUrl = connected.addonUrl;
        addonUrlBox.textContent = addonUrl;
        install.onclick = () => {
          const u = new URL(addonUrl);
          window.location.href = `stremio://${u.host}${u.pathname}`;
        };
        result.classList.remove("hidden");
        status.textContent = "Fatto. Ora installa il tuo addon in Stremio.";
        if (win && !win.closed) win.close();
        break;
      }

      await sleep(700);
    }

    if (!addonUrl) throw new Error("Collegamento non completato entro 5 minuti.");
  } catch (e) {
    if (win && !win.closed) win.close();
    showError(e.message || "Errore durante il collegamento");
    status.textContent = "";
  } finally {
    busy = false;
    connect.disabled = false;
  }
});

copy.addEventListener("click", async () => {
  if (!addonUrl) return;
  await navigator.clipboard.writeText(addonUrl);
  copy.textContent = "Copiato ✓";
  setTimeout(() => copy.textContent = "Copia URL", 1500);
});
