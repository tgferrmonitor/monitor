import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  },
  forcePathStyle: true,
});

async function listObjects(prefix) {
  const cmd = new ListObjectsV2Command({
    Bucket: process.env.S3_BUCKET,
    Prefix: prefix + '/',
  });
  const res = await s3.send(cmd);
  return res.Contents || [];
}

async function copyObject(sourceKey, destKey) {
  const cmd = new CopyObjectCommand({
    Bucket: process.env.S3_BUCKET,
    CopySource: `${process.env.S3_BUCKET}/${sourceKey}`,
    Key: destKey,
  });
  return s3.send(cmd);
}

async function deleteObject(key) {
  const cmd = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });
  return s3.send(cmd);
}

async function migrate(
  dryRun = true,
  sourcePrefix = 'reports/hours',
  destPrefix = 'reports'
) {
  console.log(
    `Migrate from ${sourcePrefix} -> ${destPrefix} (dryRun=${dryRun})`
  );
  const objs = await listObjects(sourcePrefix);
  for (const o of objs) {
    const srcKey = o.Key;
    const filename = srcKey.split('/').pop();
    const destKey = `${destPrefix}/${filename}`;
    console.log(`${dryRun ? '[DRY]' : '[DO]'} ${srcKey} -> ${destKey}`);
    if (!dryRun) {
      await copyObject(srcKey, destKey);
      await deleteObject(srcKey);
    }
  }
}

// CLI
const args = process.argv.slice(2);
const dry = args.includes('--no-dryrun') ? false : true;
const srcArg = args.find((a) => a.startsWith('--src='));
const dstArg = args.find((a) => a.startsWith('--dst='));
const src = srcArg ? srcArg.split('=')[1] : 'reports/hours';
const dst = dstArg ? dstArg.split('=')[1] : 'reports';

migrate(dry, src, dst)
  .then(() => console.log('done'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
