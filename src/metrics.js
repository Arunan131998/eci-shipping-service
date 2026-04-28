const client = require('prom-client');

client.collectDefaultMetrics();

const shipmentsCreatedTotal = new client.Counter({
  name: 'shipments_created_total',
  help: 'Total shipments created'
});

module.exports = {
  register: client.register,
  shipmentsCreatedTotal
};
