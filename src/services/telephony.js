// Pluggable telephony. Every provider implements: async call({ to, leadId }) -> { provider, callId, status, telLink }
const providers = {
  mock: { async call({ to }) { return { provider: 'mock', callId: 'mock_call_' + Date.now(), status: 'initiated', telLink: `tel:${to}` }; } },
  tel: { async call({ to }) { return { provider: 'tel', callId: null, status: 'tel_link', telLink: `tel:${to}` }; } },
  twilio: {
    // Click-to-call: Twilio rings the agent first, then bridges to the lead.
    async call({ to }) {
      const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM_NUMBER: from, AGENT_PHONE_NUMBER: agent } = process.env;
      if (!sid || !tok || !from || !agent) throw new Error('Twilio env vars missing');
      const twiml = `<Response><Say>Connecting your call from Mohan Lal Mishra.</Say><Dial callerId="${from}">${to}</Dial></Response>`;
      const body = new URLSearchParams({ To: agent, From: from, Twiml: twiml });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST', body, headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') } });
      const j = await r.json(); if (!r.ok) throw new Error(j.message || 'Twilio error');
      return { provider: 'twilio', callId: j.sid, status: j.status, telLink: `tel:${to}` };
    } },
};
function getProvider(name) { return providers[(name || process.env.TELEPHONY_PROVIDER || 'mock').toLowerCase()] || providers.mock; }
module.exports = { getProvider, register: (n, impl) => { providers[n] = impl; } };
