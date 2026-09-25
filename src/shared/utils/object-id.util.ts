import { Types } from 'mongoose';

/**
 * Safely converts any string ID (whether valid 24-hex ObjectId or custom slug string like 'proj-acme')
 * into a valid Mongoose Types.ObjectId without throwing BSONError or CastError.
 */
export function toValidObjectId(id: string | undefined): Types.ObjectId {
  if (!id) {
    return new Types.ObjectId();
  }
  if (Types.ObjectId.isValid(id)) {
    return new Types.ObjectId(id);
  }
  const hex = Buffer.from(id).toString('hex').padEnd(24, '0').substring(0, 24);
  return new Types.ObjectId(hex);
}
