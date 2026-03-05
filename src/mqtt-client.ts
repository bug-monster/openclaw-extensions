import mqtt from 'mqtt';
import crypto from 'crypto';
import { IoTCredential } from './credential';

// 映射简化的 region 到完整的 AWS region
function mapToFullRegion(shortRegion: string): string {
  const regionMap: { [key: string]: string } = {
    'us': 'us-east-1',
    'eu': 'eu-west-1',
    'ap': 'ap-southeast-1',
  };
  return regionMap[shortRegion] || shortRegion;
}

export function createIoTMqttClient(cred: IoTCredential, qos: 0 | 1 = 1): mqtt.MqttClient {
  // 映射简化的 region 到完整的 AWS region
  const fullRegion = mapToFullRegion(cred.region);
  const signedUrl = signV4Url(`wss://${cred.iotEndpoint}/mqtt`, cred, fullRegion);

  console.log('[SwitchBot MQTT] Endpoint:', cred.iotEndpoint);
  console.log('[SwitchBot MQTT] Region:', cred.region, '→', fullRegion);
  console.log('[SwitchBot MQTT] ClientId:', cred.clientId);
  console.log('[SwitchBot MQTT] Signed URL (truncated):', signedUrl.slice(0, 120) + '...');
  console.log('[SwitchBot MQTT] Subscribe topic:', cred.topics.subscribe);
  console.log('[SwitchBot MQTT] Has CA cert:', !!cred.caCertificate, 'length:', cred.caCertificate?.length);

  const client = mqtt.connect(signedUrl, {
    clientId: cred.clientId,
    protocolVersion: 5,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    // WSS 连接使用系统 CA，不需要手动指定
  });

  // 只订阅，不 publish
  client.on('connect', () => {
    console.log(`[SwitchBot] MQTT 已连接到 ${fullRegion} (${cred.clientId})`);

    // topics.subscribe 现在是字符串，不是数组
    const topic = cred.topics.subscribe;
    client.subscribe(topic, { qos }, (err) => {
      if (err) {
        console.error(`[SwitchBot] 订阅主题失败: ${topic}`, err);
      } else {
        console.log(`[SwitchBot] 已订阅主题: ${topic} (QoS ${qos})`);
      }
    });
  });

  client.on('error', (error) => {
    console.error('[SwitchBot] MQTT 连接错误:', error.message || error);
    console.error('[SwitchBot] MQTT error detail:', JSON.stringify(error, Object.getOwnPropertyNames(error)).slice(0, 500));
  });

  client.on('offline', () => {
    console.warn('[SwitchBot] MQTT 连接断开，尝试重连中...');
  });

  client.on('close', () => {
    console.warn('[SwitchBot] MQTT close event');
  });

  client.on('disconnect', (packet: any) => {
    console.warn('[SwitchBot] MQTT disconnect packet:', JSON.stringify(packet));
  });

  client.on('reconnect', () => {
    console.log('[SwitchBot] MQTT 重连中...');
  });

  return client;
}

// 凭证续期 → 断开旧连接 → 用新凭证重建
export function reconnectWithNewCred(
  oldClient: mqtt.MqttClient,
  newCred: IoTCredential,
  qos: 0 | 1 = 1,
): mqtt.MqttClient {
  console.log('[SwitchBot] 使用新凭证重建 MQTT 连接...');

  oldClient.end(true);
  return createIoTMqttClient(newCred, qos);
}

// AWS SigV4 URL 签名函数 (简化实现)
function signV4Url(url: string, cred: IoTCredential, fullRegion: string): string {
  const urlObj = new URL(url);
  const { credentials } = cred;

  // 构建 AWS SigV4 签名参数
  const timestamp = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const date = timestamp.substr(0, 8);

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${date}/${fullRegion}/iotdevicegateway/aws4_request`,
    'X-Amz-Date': timestamp,
    'X-Amz-SignedHeaders': 'host',
  });

  if (credentials.sessionToken) {
    queryParams.set('X-Amz-Security-Token', credentials.sessionToken);
  }

  // 创建待签名字符串 — canonical query string 必须按参数名字母排序
  const sortedParams = new URLSearchParams([...queryParams.entries()].sort((a, b) => a[0].localeCompare(b[0])));

  const canonicalRequest = [
    'GET',
    '/mqtt',
    sortedParams.toString(),
    `host:${urlObj.hostname}`,
    '',
    'host',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' // empty payload hash
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    `${date}/${fullRegion}/iotdevicegateway/aws4_request`,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  // 计算签名
  const kDate = crypto.createHmac('sha256', `AWS4${credentials.secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(fullRegion).digest();
  const kService = crypto.createHmac('sha256', kRegion).update('iotdevicegateway').digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  queryParams.set('X-Amz-Signature', signature);

  // 最终 URL 也用排序后的参数
  const finalParams = new URLSearchParams([...queryParams.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return `${url}?${finalParams.toString()}`;
}