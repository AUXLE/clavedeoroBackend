// routes.js (Supabase-first auth + database)
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

/* ----------------------------- Supabase Setup ----------------------------- */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-side secret
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


// ⬇️ add near the top of routes.js with other imports
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const path = require('path');

// In-memory file store (we stream buffers to Supabase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB/file
});

// Helpers to build keys & URLs
const REVIEW_BUCKET = 'review-images';
const PROPERTY_BUCKET = 'property-images';

// Upload buffer to Supabase Storage and return its public URL
async function uploadToBucket(bucket, fileBuffer, originalName, mimetype, subfolder = '') {
  const ext = mime.extension(mimetype) || path.extname(originalName).replace('.', '') || 'bin';
  const key = [subfolder, `${uuidv4()}.${ext}`].filter(Boolean).join('/');

  const { error: upErr } = await supabase
    .storage
    .from(bucket)
    .upload(key, fileBuffer, { contentType: mimetype, upsert: false });

  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(key);
  return { key, publicUrl: pub.publicUrl };
}

/* ---------------------------- Nodemailer Setup ---------------------------- */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
  },
});

/* --------------------------------- Helpers -------------------------------- */
const sendContactForm = async (formData) => {
  const mailOptions = {
    from: process.env.MAIL_FROM || process.env.MAIL_USER || '',
    to: formData.email,
    subject: 'New Contact Form',
    text: `
Name: ${formData.name}
Phone Number: ${formData.phone}
Email: ${formData.email}
Subject: ${formData.subject}
Country Code: ${formData.countryCode}
`.trim(),
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Email sent:', info.response);

  const mailOptions2 = {
    from: process.env.MAIL_FROM || process.env.MAIL_USER || '',
    to: process.env.MAIL_FROM || process.env.MAIL_USER || '',
    subject: 'New Contact Form',
    text: `
Name: ${formData.name}
Phone Number: ${formData.phone}
Email: ${formData.email}
Subject: ${formData.subject}
Country Code: ${formData.countryCode}
`.trim(),
  };

  const info2 = await transporter.sendMail(mailOptions2);
  console.log('Email sent:', info2.response);
};

/* ------------------------- Auth & Admin Middlewares ------------------------ */
/**
 * Expects Authorization: Bearer <supabase_access_token>
 * Validates token with Supabase and attaches req.user (Supabase user object).
 */
const verifySupabaseUser = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.split(' ')[1]; // 'Bearer <token>'
    if (!token) return res.status(403).json({ message: 'Access denied: missing token' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ message: 'Invalid or expired Supabase token' });
    }

    req.user = data.user; // Supabase user
    return next();
  } catch (err) {
    console.error('verifySupabaseUser error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Requires the signed-in user to be marked as admin.
 * Expects an `admin_users` table with:
 *  - auth_user_id uuid (PK or unique), is_admin boolean
 */
const requireAdmin = async (req, res, next) => {
  try {
    const authUserId = req.user?.id;
    if (!authUserId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { data: adminRow, error } = await supabase
      .from('admin_users')
      .select('auth_user_id, is_admin')
      .eq('auth_user_id', authUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Supabase error (admin check):', error);
      return res.status(500).json({ message: 'Server error' });
    }

    if (!adminRow || !adminRow.is_admin) {
      return res.status(403).json({ message: 'Admin privileges required' });
    }

    req.admin = { auth_user_id: adminRow.auth_user_id, is_admin: adminRow.is_admin };
    return next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ---------------------------------- Routes --------------------------------- */

/**
 * Admin Login (Supabase Auth)
 * NOTE: Prefer the client to call Supabase Auth directly.
 * This server proxy is provided if you need a backend endpoint.
 * Body: { email, password }
 * Returns: { access_token, refresh_token, user }
 */
router.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || typeof email !== 'string' || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Avoid leaking specifics; map to generic error
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Optional: ensure the user is an admin before issuing tokens to client
    const authUserId = data.user?.id;
    if (!authUserId) {
      return res.status(500).json({ message: 'Unexpected auth response' });
    }

    const { data: adminRow, error: adminErr } = await supabase
      .from('admin_users')
      .select('auth_user_id, is_admin')
      .eq('auth_user_id', authUserId)
      .single();

    if (adminErr && adminErr.code !== 'PGRST116') {
      console.error('Supabase error (admin lookup on login):', adminErr);
      return res.status(500).json({ message: 'Server error' });
    }

    if (!adminRow || !adminRow.is_admin) {
      return res.status(403).json({ message: 'Admin privileges required' });
    }

    return res.json({
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      user: data.user,
    });
  } catch (err) {
    console.error('Error during admin login:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* ----------------------------- Admin: Properties ---------------------------- */
// Create Property
router.post('/admin/properties', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      location,
      owner,
      area,
      exactAddress,
      bhkType,
      amenities,
      ratings,
      reviews,
      image,
    } = req.body;

    if (!name || !owner || !price || !area || !exactAddress || !bhkType || !location) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const payload = {
      name,
      description,
      price,
      location,
      owner,
      area,
      exactAddress,
      bhkType,
      amenities,
      ratings,
      reviews,
      image,
      // Optionally track creator:
      created_by: req.user.id,
    };

    const { data, error } = await supabase.from('properties').insert(payload).select().single();
    if (error) {
      console.error('Supabase error (create property):', error);
      return res.status(500).json({ message: 'Error creating property', error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error('Error creating property:', err);
    return res.status(500).json({ message: 'Error creating property', error: err.message });
  }
});

// POST /admin/properties/:id/upload-images  (field: files[])
// merges new image URLs into properties.images (jsonb array)
router.post(
  '/admin/properties/:id/upload-images',
  verifySupabaseUser,
  requireAdmin,
  upload.array('files', 10),
  async (req, res) => {
    try {
      const { id } = req.params;
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ message: 'No files uploaded' });

      // ensure property exists & get current images array
      const { data: prop, error: getErr } = await supabase
        .from('properties')
        .select('id, images')
        .eq('id', id)
        .single();

      if (getErr && getErr.code === 'PGRST116') {
        return res.status(404).json({ message: 'Property not found' });
      }
      if (getErr) {
        console.error('Get property error:', getErr);
        return res.status(500).json({ message: 'Error reading property', error: getErr.message });
      }

      const uploaded = [];
      for (const file of files) {
        const { buffer, mimetype, originalname } = file;
        const { publicUrl } = await uploadToBucket(PROPERTY_BUCKET, buffer, originalname, mimetype, `properties/${id}`);
        uploaded.push(publicUrl);
      }

      const current = Array.isArray(prop.images) ? prop.images : [];
      const updatedImages = [...current, ...uploaded];

      const { data: updated, error: updErr } = await supabase
        .from('properties')
        .update({ images: updatedImages })
        .eq('id', id)
        .select()
        .single();

      if (updErr) {
        console.error('Update property images error:', updErr);
        return res.status(500).json({ message: 'Failed to save image URLs', error: updErr.message });
      }

      return res.status(200).json({ message: 'Uploaded', images: updated.images });
    } catch (err) {
      console.error('Property images upload failed:', err);
      return res.status(500).json({ message: 'Upload failed', error: err.message });
    }
  }
);

// DELETE /admin/properties/:id/images
// body: { url: "https://.../property-images/properties/<id>/<file>" }
router.delete(
  '/admin/properties/:id/images',
  verifySupabaseUser,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { url } = req.body;
      if (!url) return res.status(400).json({ message: 'Missing url' });

      // get property
      const { data: prop, error: getErr } = await supabase
        .from('properties')
        .select('id, images')
        .eq('id', id)
        .single();

      if (getErr && getErr.code === 'PGRST116') return res.status(404).json({ message: 'Property not found' });
      if (getErr) return res.status(500).json({ message: 'Error reading property', error: getErr.message });

      const images = Array.isArray(prop.images) ? prop.images : [];
      if (!images.includes(url)) return res.status(400).json({ message: 'URL not found on property' });

      // derive object path from public URL
      // public URL looks like: https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>
      const base = `/storage/v1/object/public/${PROPERTY_BUCKET}/`;
      const idx = url.indexOf(base);
      if (idx === -1) return res.status(400).json({ message: 'Unrecognized storage URL' });

      const objectPath = url.slice(idx + base.length); // e.g. properties/<id>/<filename>

      // delete from storage
      const { error: delErr } = await supabase.storage.from(PROPERTY_BUCKET).remove([objectPath]);
      if (delErr) return res.status(500).json({ message: 'Failed to delete file', error: delErr.message });

      // remove from DB
      const newImages = images.filter((u) => u !== url);
      const { data: updated, error: updErr } = await supabase
        .from('properties')
        .update({ images: newImages })
        .eq('id', id)
        .select()
        .single();

      if (updErr) return res.status(500).json({ message: 'Failed to update DB', error: updErr.message });

      return res.status(200).json({ message: 'Removed', images: updated.images });
    } catch (err) {
      console.error('Delete property image failed:', err);
      return res.status(500).json({ message: 'Delete failed', error: err.message });
    }
  }
);


// Protected Admin Route (sanity check)
router.get('/admin/protected', verifySupabaseUser, requireAdmin, (req, res) => {
  res.json({
    message: 'Access granted to protected route',
    user: req.user,
    admin: req.admin,
  });
});

/* ------------------------------- Public: Read ------------------------------- */
// Fetch All Properties (add filters as needed)
router.get('/properties', async (_req, res) => {
  try {
    const query = supabase.from('properties').select('*');
    const { data, error } = await query;
    if (error) {
      console.error('Supabase error (list properties):', error);
      return res.status(500).json({ message: 'Error fetching properties', error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching properties', error: err.message });
  }
});

// Fetch Single Property
router.get('/properties/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.from('properties').select('*').eq('id', id).single();

    if (error && error.code === 'PGRST116') {
      return res.status(404).json({ message: 'Property not found' });
    }
    if (error) {
      console.error('Supabase error (get property):', error);
      return res.status(500).json({ message: 'Error fetching property', error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching property:', err);
    return res.status(500).json({ message: 'Error fetching property', error: err.message });
  }
});

/* ----------------------------- Admin: Update/Delete ----------------------------- */
// Update Property
router.put('/admin/properties/:id', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure property exists
    const { error: getErr } = await supabase
      .from('properties')
      .select('id')
      .eq('id', id)
      .single();

    if (getErr && getErr.code === 'PGRST116') {
      return res.status(404).json({ message: 'Property not found' });
    }
    if (getErr) {
      console.error('Supabase error (check property exists):', getErr);
      return res.status(500).json({ message: 'Error updating property', error: getErr.message });
    }

    const { data, error } = await supabase
      .from('properties')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase error (update property):', error);
      return res.status(500).json({ message: 'Error updating property', error: error.message });
    }

    return res.status(200).json({ message: 'Property updated successfully', property: data });
  } catch (err) {
    return res.status(500).json({ message: 'Error updating property', error: err.message });
  }
});

// Delete Property
router.delete('/admin/properties/:id', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure exists
    const { error: getErr } = await supabase
      .from('properties')
      .select('id')
      .eq('id', id)
      .single();

    if (getErr && getErr.code === 'PGRST116') {
      return res.status(404).json({ message: 'Property not found' });
    }
    if (getErr) {
      console.error('Supabase error (check property exists):', getErr);
      return res.status(500).json({ message: 'Error deleting property', error: getErr.message });
    }

    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (error) {
      console.error('Supabase error (delete property):', error);
      return res.status(500).json({ message: 'Error deleting property', error: error.message });
    }

    return res.status(200).json({ message: 'Property deleted successfully' });
  } catch (err) {
    return res.status(500).json({ message: 'Error deleting property', error: err.message });
  }
});

/* --------------------------------- Health --------------------------------- */
router.get('/', (_req, res) => {
  res.send('API is running...');
});

/* ------------------------------- Contact Form ------------------------------ */
router.post('/contactform', async (req, res) => {
  const formData = req.body;
  if (!formData.name || !formData.phone || !formData.email) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    await sendContactForm(formData);
    return res.status(200).json({ message: 'Form submitted successfully, email sent.' });
  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ message: 'Error sending email', error: error.message });
  }
});

/* ------------------------------- Reviews CRUD ------------------------------ */
// Create Review
router.post('/admin/reviews', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const { customerName, ratings, review, image } = req.body;

    if (!customerName || ratings === undefined || ratings === null) {
      return res.status(400).json({ message: 'Customer name and ratings are required' });
    }

    const payload = { customerName, ratings, review, image, created_by: req.user.id };
    const { data, error } = await supabase.from('reviews').insert(payload).select().single();

    if (error) {
      console.error('Supabase error (add review):', error);
      return res.status(500).json({ message: 'Server error', error: error.message });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error('Error adding review:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Update Review
router.put('/admin/reviews/:id', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customerName, ratings, image, comments } = req.body;

    // Ensure exists
    const { error: getErr } = await supabase
      .from('reviews')
      .select('id')
      .eq('id', id)
      .single();

    if (getErr && getErr.code === 'PGRST116') {
      return res.status(404).json({ message: 'Review not found' });
    }
    if (getErr) {
      console.error('Supabase error (check review exists):', getErr);
      return res.status(500).json({ message: 'Error updating review', error: getErr.message });
    }

    const updatePayload = {
      customerName,
      ratings,
      image,
      review: comments, // keep same behavior as before
      updated_by: req.user.id,
    };

    const { data, error } = await supabase
      .from('reviews')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase error (update review):', error);
      return res.status(500).json({ message: 'Error updating review', error: error.message });
    }

    return res.status(200).json({ message: 'Review updated successfully', review: data });
  } catch (err) {
    console.error('Error updating review:', err);
    return res.status(500).json({ message: 'Error updating review', error: err.message });
  }
});

// Delete Review
router.delete('/admin/reviews/:id', verifySupabaseUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Ensure exists
    const { error: getErr } = await supabase
      .from('reviews')
      .select('id')
      .eq('id', id)
      .single();

    if (getErr && getErr.code === 'PGRST116') {
      return res.status(404).json({ message: 'Review not found' });
    }
    if (getErr) {
      console.error('Supabase error (check review exists):', getErr);
      return res.status(500).json({ message: 'Server error', error: getErr.message });
    }

    const { error } = await supabase.from('reviews').delete().eq('id', id);
    if (error) {
      console.error('Supabase error (delete review):', error);
      return res.status(500).json({ message: 'Server error', error: error.message });
    }

    return res.status(200).json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Error deleting review:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /admin/reviews/upload-image  (field: file)
router.post(
  '/admin/reviews/upload-image',
  verifySupabaseUser,
  requireAdmin,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

      const { buffer, mimetype, originalname } = req.file;
      const { publicUrl } = await uploadToBucket(REVIEW_BUCKET, buffer, originalname, mimetype, 'reviews');

      // return URL so the client can put it into the "image" field when creating/updating a review
      return res.status(200).json({ url: publicUrl });
    } catch (err) {
      console.error('Review image upload failed:', err);
      return res.status(500).json({ message: 'Upload failed', error: err.message });
    }
  }
);


// List Reviews (public)
router.get('/reviews', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('reviews').select('*');
    if (error) {
      console.error('Supabase error (fetch reviews):', error);
      return res.status(500).json({ message: 'Server error', error: error.message });
    }
    return res.status(200).json(data || []);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
