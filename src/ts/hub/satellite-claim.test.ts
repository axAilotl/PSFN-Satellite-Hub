import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSatelliteClaimEnvelope,
  normalizeSatelliteClaimConfig,
} from "./satellite-claim.js";

test("satellite claim config supports mobile location endpoint profiles", () => {
  const config = normalizeSatelliteClaimConfig({
    capabilityProfile: "mobile-location",
    satelliteId: "phone-sat",
    endpointId: "phone-browser",
    displayName: "Phone Browser",
  });

  assert.equal(config.namespace, "satellite.endpoint");
  assert.equal(config.channelType, "satellite.endpoint");
  assert.equal(config.endpointClass, "mobile");
  assert.equal(config.locationMode, "mobile");
  assert.deepEqual(config.telemetry, {
    mode: "event",
    categories: ["location", "timezone", "presence", "battery", "health"],
  });
});

test("satellite claim envelope carries current capabilities without granting permissions", () => {
  const config = normalizeSatelliteClaimConfig({
    capabilityProfile: "voxta-avatar",
    satelliteId: "voxta-vam",
    endpointId: "vam-plugin",
    displayName: "Voxta VaM",
  });
  const envelope = buildSatelliteClaimEnvelope({
    config,
    conversationId: "voxta:chat-1",
    apiKey: "secret",
    channel: {
      sessionId: "voxta:chat-1",
      channelType: "satellite.endpoint",
      channelId: "satellite.endpoint:voxta:chat-1",
      sourceSatelliteId: "voxta-vam",
      sourceSatelliteName: "Voxta VaM",
      activeSatellites: [
        {
          id: "voxta-vam",
          name: "Voxta VaM",
          transport: "websocket",
          capabilities: {
            input: ["text"],
            output: ["text", "subtitle"],
            control: ["interrupt", "presence"],
            safety: ["action_allowlist"],
          },
        },
      ],
    },
  });

  assert.equal(envelope.claim.namespace, "satellite.endpoint");
  assert.equal(envelope.claim.type, "voxta-avatar");
  assert.equal(envelope.claim.deviceClass, "avatar");
  assert.deepEqual(envelope.capabilities.current, {
    input: ["text"],
    output: ["text", "subtitle"],
    control: ["interrupt", "presence"],
    safety: ["action_allowlist"],
  });
  assert.deepEqual(envelope.auth, {
    mode: "bearer",
    clientCertificateConfigured: false,
  });
});
