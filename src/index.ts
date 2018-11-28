import { S3 } from 'aws-sdk';
import { Disk, ReadResult, WriteResult } from 'file-disk';

interface S3Params {
	Bucket: string;
	Key: string;
	Range?: string;
}

function getContentLength(
	response: S3.GetObjectOutput | S3.HeadObjectOutput,
): number {
	const contentLength = response.ContentLength;
	if (contentLength === undefined) {
		throw new Error('No ContentLength in S3 response');
	}
	return contentLength;
}

export class S3Disk extends Disk {
	constructor(
		protected readonly s3: S3,
		protected readonly bucket: string,
		protected readonly key: string,
		recordReads: boolean = false,
		discardIsZero: boolean = true,
	) {
		super(true, true, recordReads, discardIsZero);
	}

	private getS3Params(): S3Params {
		return { Bucket: this.bucket, Key: this.key };
	}

	protected async _getCapacity(): Promise<number> {
		const data = await this.s3.headObject(this.getS3Params()).promise();
		return getContentLength(data);
	}

	protected async _read(
		buffer: Buffer,
		bufferOffset: number,
		length: number,
		fileOffset: number,
	): Promise<ReadResult> {
		const params = this.getS3Params();
		params.Range = `bytes=${fileOffset}-${fileOffset + length - 1}`;
		const data = await this.s3.getObject(params).promise();
		(data.Body as Buffer).copy(buffer, bufferOffset);
		return { bytesRead: getContentLength(data), buffer };
	}

	protected async _write(
		buffer: Buffer,
		bufferOffset: number,
		length: number,
		fileOffset: number,
	): Promise<WriteResult> {
		throw new Error("Can't write in an S3Disk");
	}

	protected async _flush(): Promise<void> {
		throw new Error("Can't flush an S3Disk");
	}
}
