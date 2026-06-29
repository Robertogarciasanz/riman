export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);

    if (url.pathname === '/crear-pedido') {
      try {
        const { items } = await request.json();
        const token = await getToken(env.PAYPAL_CLIENT_ID, env.PAYPAL_SECRET);
        const order = await crearOrder(token, items);
        const link = order.links && order.links.find(l => l.rel === 'approve');
        if (!link) throw new Error('Sin link de aprobación: ' + JSON.stringify(order));
        return new Response(JSON.stringify({ url: link.href }), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    if (url.pathname === '/ipn') {
      const body = await request.text();
      const verificacion = await fetch('https://ipnpb.paypal.com/cgi-bin/webscr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'cmd=_notify-validate&' + body,
      });
      const resultado = await verificacion.text();
      if (resultado === 'VERIFIED') {
        const params = new URLSearchParams(body);
        console.log('PAGO VERIFICADO:', params.get('payment_status'), params.get('mc_gross'), params.get('payer_email'));
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  }
};

async function getToken(clientId, secret) {
  const credentials = `${String(clientId).trim()}:${String(secret).trim()}`;
  const uint8 = new TextEncoder().encode(credentials);
  const b64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));

  const res = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + b64,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function crearOrder(token, items) {
  const total = items.reduce((s, i) => s + Number(i.precio) * Number(i.qty), 0).toFixed(2);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [{
      description: 'RIMAN Salamanca · ICD Dermatology',
      amount: {
        currency_code: 'EUR',
        value: total,
        breakdown: { item_total: { currency_code: 'EUR', value: total } }
      },
      items: items.map(i => ({
        name: String(i.nombre).substring(0, 127),
        quantity: String(i.qty),
        unit_amount: { currency_code: 'EUR', value: Number(i.precio).toFixed(2) },
        category: 'PHYSICAL_GOODS',
      })),
    }],
    application_context: {
      brand_name: 'RIMAN Salamanca',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
      return_url: 'https://rimansalamanca.com/?pago=ok',
      cancel_url: 'https://rimansalamanca.com/?pago=cancelado',
    }
  };

  const res = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}
