# s3-disk
Handles reads / writes on disk image files stored in S3.

[![Build Status](https://travis-ci.org/balena-io-modules/s3-disk.svg?branch=master)](https://travis-ci.org/balena-io-modules/s3-disk)

### S3Disk

`S3Disk` acts like [`FileDisk`](https://github.com/balena-io-modules/file-disk) except it reads the image file from S3 instead of
the filesystem. `S3Disk` has `readOnly` and `recordWrites` enabled. This can not be changed.

`new S3Disk(s3, bucket, key, recordReads, discardIsZero=true)`

 - `s3` is an s3 connection.
 - `bucket` is the S3 bucket to use.
 - `key` is the key (file name) to use in the bucket.

For more information about S3Disk parameters see
[the aws documentation](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html)
