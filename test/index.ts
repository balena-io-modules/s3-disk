import * as assert from 'assert';
import * as aws from 'aws-sdk';
import { createHash } from 'crypto';
import { describe } from 'mocha';
import { createReadStream } from 'fs';
import * as path from 'path';

import { S3Disk } from '../src';

const BUCKET_NAME = 'fixtures';
const FILE_NAME = 'zeros';
const DISK_PATH = path.join(__dirname, BUCKET_NAME, FILE_NAME);
const DISK_SIZE = 10240;
const S3 = new aws.S3({
	accessKeyId: 'access_key',
	secretAccessKey: 'secret_key',
	endpoint: 'http://0.0.0.0:9042',
	s3ForcePathStyle: true,
	sslEnabled: false,
});

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
	return await new Promise(
		(resolve: (buffer: Buffer) => void, reject: (error: Error) => void) => {
			const chunks: Buffer[] = [];
			stream.on('error', reject);
			stream.on('data', chunks.push.bind(chunks));
			stream.on('end', () => {
				resolve(Buffer.concat(chunks));
			});
		},
	);
}

function sha256(buffer: Buffer): string {
	const hash = createHash('sha256');
	hash.update(buffer);
	return hash.digest('hex');
}

function createS3CowDisk(): S3Disk {
	// read only
	// record writes
	// don't record reads
	// read discarded chunks from the disk anyway
	return new S3Disk(S3, BUCKET_NAME, FILE_NAME, true, true);
}

async function testOnAllDisks(
	fn: (disk: S3Disk) => Promise<void>,
): Promise<void> {
	await fn(createS3CowDisk());
}

describe('s3-disk', () => {
	async function testGetCapacity(disk: S3Disk) {
		const size = await disk.getCapacity();
		assert.strictEqual(size, DISK_SIZE);
	}

	it('getCapacity should return the disk size', async () => {
		await testOnAllDisks(testGetCapacity);
	});

	async function readRespectsLength(disk: S3Disk) {
		const buf = Buffer.allocUnsafe(1024);
		buf.fill(1);
		const result = await disk.read(buf, 0, 10, 0);
		const firstTenBytes = Buffer.allocUnsafe(10);
		firstTenBytes.fill(0);
		// first ten bytes were read: zeros
		assert(result.buffer.slice(0, 10).equals(firstTenBytes));
		assert.strictEqual(result.bytesRead, 10);
		const rest = Buffer.alloc(1024 - 10);
		rest.fill(1);
		// the rest was not updated: ones
		assert(result.buffer.slice(10).equals(rest));
	}

	it('read should respect the length parameter', async () => {
		await testOnAllDisks(readRespectsLength);
	});

	async function writeRespectsLength(disk: S3Disk) {
		const buf = Buffer.alloc(1024);
		buf.fill(1);
		await disk.write(buf, 0, 10, 0);
		const result = await disk.read(Buffer.allocUnsafe(1024), 0, 1024, 0);
		const firstTenBytes = Buffer.allocUnsafe(10);
		firstTenBytes.fill(1);
		// first ten bytes were written: ones
		assert(result.buffer.slice(0, 10).equals(firstTenBytes));
		assert.strictEqual(result.bytesRead, 1024);
		const rest = Buffer.alloc(1024 - 10);
		// the rest was not written: zeros
		assert(result.buffer.slice(10).equals(rest));
	}

	it('write should respect the length parameter', async () => {
		await testOnAllDisks(writeRespectsLength);
	});

	async function shouldReadAndWrite(disk: S3Disk) {
		const buf = Buffer.allocUnsafe(1024);
		buf.fill(1);
		const writeResult = await disk.write(buf, 0, buf.length, 0);
		assert.strictEqual(writeResult.bytesWritten, buf.length);
		const buf2 = Buffer.allocUnsafe(1024);
		const readResult = await disk.read(buf2, 0, buf2.length, 0);
		assert.strictEqual(readResult.bytesRead, readResult.buffer.length);
		assert(buf.equals(readResult.buffer));
		await disk.flush();
	}

	it('should write and read', async () => {
		await testOnAllDisks(shouldReadAndWrite);
	});

	function createBuffer(pattern: string, size?: number): Buffer {
		// Helper for checking disk contents.
		size = size === undefined ? pattern.length : size;
		const buffer = Buffer.alloc(size);
		Buffer.from(Array.from(pattern).map(Number)).copy(buffer);
		return buffer;
	}

	async function checkDiskContains(disk: S3Disk, pattern: string) {
		// Helper for checking disk contents.
		const size = 32;
		const expected = createBuffer(pattern, size);
		const { buffer } = await disk.read(Buffer.allocUnsafe(size), 0, size, 0);
		assert(buffer.equals(expected));
	}

	async function overlappingWrites(disk: S3Disk) {
		const buf = Buffer.allocUnsafe(8);
		await disk.discard(0, DISK_SIZE);

		buf.fill(1);
		await disk.write(buf, 0, buf.length, 0);
		await checkDiskContains(disk, '11111111');

		buf.fill(2);
		await disk.write(buf, 0, buf.length, 4);
		await checkDiskContains(disk, '111122222222');

		buf.fill(3);
		await disk.write(buf, 0, buf.length, 8);
		await checkDiskContains(disk, '1111222233333333');

		buf.fill(4);
		await disk.write(buf, 0, buf.length, 24);
		await checkDiskContains(disk, '11112222333333330000000044444444');

		buf.fill(5);
		await disk.write(buf, 0, 2, 3);
		await checkDiskContains(disk, '11155222333333330000000044444444');

		// Test disk readable stream:
		const buffer1 = await streamToBuffer(await disk.getStream());
		const expected1 = createBuffer(
			'11155222333333330000000044444444',
			DISK_SIZE,
		);
		assert(buffer1.equals(expected1));

		// Test getStream with start position
		const buffer2 = await streamToBuffer(await disk.getStream(3));
		const expected2 = createBuffer(
			'55222333333330000000044444444',
			DISK_SIZE - 3,
		);
		assert(buffer2.equals(expected2));

		// Test getStream with start position and length
		const buffer3 = await streamToBuffer(await disk.getStream(3, 4));
		const expected3 = createBuffer('5522');
		assert(buffer3.equals(expected3));

		buf.fill(6);
		await disk.write(buf, 0, 5, 2);
		await checkDiskContains(disk, '11666662333333330000000044444444');

		buf.fill(7);
		await disk.write(buf, 0, 2, 30);
		await checkDiskContains(disk, '11666662333333330000000044444477');

		buf.fill(8);
		await disk.write(buf, 0, 8, 14);
		await checkDiskContains(disk, '11666662333333888888880044444477');

		buf.fill(9);
		await disk.write(buf, 0, 8, 6);
		await checkDiskContains(disk, '11666699999999888888880044444477');

		const discarded = disk.getDiscardedChunks();
		assert.strictEqual(discarded.length, 2);
		assert.strictEqual(discarded[0].start, 22);
		assert.strictEqual(discarded[0].end, 23);
		assert.strictEqual(discarded[1].start, 32);
		assert.strictEqual(discarded[1].end, 10239);

		const ranges1 = await disk.getRanges(1);
		assert.deepEqual(ranges1, [
			{ offset: 0, length: 22 },
			{ offset: 24, length: 8 },
		]);

		const ranges2 = await disk.getRanges(2);
		assert.deepEqual(ranges2, [
			{ offset: 0, length: 22 },
			{ offset: 24, length: 8 },
		]);

		const ranges3 = await disk.getRanges(3);
		assert.deepEqual(ranges3, [{ offset: 0, length: 33 }]);

		const ranges4 = await disk.getRanges(4);
		assert.deepEqual(ranges4, [{ offset: 0, length: 32 }]);

		const ranges5 = await disk.getRanges(5);
		assert.deepEqual(ranges5, [{ offset: 0, length: 35 }]);

		const ranges6 = await disk.getRanges(6);
		assert.deepEqual(ranges6, [{ offset: 0, length: 36 }]);

		const ranges7 = await disk.getRanges(7);
		assert.deepEqual(ranges7, [{ offset: 0, length: 35 }]);

		const ranges8 = await disk.getRanges(8);
		assert.deepEqual(ranges8, [{ offset: 0, length: 32 }]);

		const ranges9 = await disk.getRanges(9);
		assert.deepEqual(ranges9, [{ offset: 0, length: 36 }]);

		const ranges10 = await disk.getRanges(10);
		assert.deepEqual(ranges10, [{ offset: 0, length: 40 }]);

		const ranges11 = await disk.getRanges(11);
		assert.deepEqual(ranges11, [{ offset: 0, length: 33 }]);

		// Test that disk.getStream() and the original image stream transformed by disk.getTransformStream() return the same streams.
		if (disk.readOnly && disk.recordWrites) {
			// This test only makes sense for disks that record writes.
			const diskStream = await disk.getStream();
			const buf1 = await streamToBuffer(diskStream);
			const originalImageStream = createReadStream(DISK_PATH);
			const transform = disk.getTransformStream();
			originalImageStream.pipe(transform);
			const buf2 = await streamToBuffer(transform);
			assert(buf1.equals(buf2));
		}
	}

	it('copy on write mode should properly record overlapping writes', async () => {
		await testOnAllDisks(overlappingWrites);
	});
});
