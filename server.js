const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const mongoose = require('mongoose');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;

const { storage } = require('./storage/storage');
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

const Product = require('./models/product');
const { body, validationResult, param } = require('express-validator');
const Category = require('./models/category');

const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const validateProduct = [
    body('name').notEmpty().withMessage('Product name is required'),
    body('title').notEmpty().withMessage('Product title is required'),
    body('description').notEmpty().withMessage('Product description is required'),
    body('category_id').notEmpty().withMessage('Category ID is required')
        .isMongoId().withMessage('Invalid category ID')
        .custom(async (value) => {
            const category = await Category.findById(value);
            if (!category) {
                throw new Error('Category not found');
            }
            return true;
        }),
];

app.post('/api/product/add',
    upload.single('image'),
    validateProduct,
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                const errorsResponse = errors.array().reduce((acc, error) => {
                    if (!acc[error.path]) {
                        acc[error.path] = error.msg;
                    }
                    return acc;
                }, {});
                return res.status(400).json({
                    success: false,
                    errors: errorsResponse,
                    message: 'Validation failed'
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No image file uploaded',
                    errors: { image: 'No image file uploaded' }
                });
            }

            const allowedMimeTypes = ['image/jpeg', 'image/png'];
            if (!allowedMimeTypes.includes(req.file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid image format. Only JPEG and PNG are allowed.',
                    errors: { image: 'Invalid image format' }
                });
            }

            // Compress the original image
            const compressedImageBuffer = await sharp(req.file.buffer)
                .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toBuffer();

            // Create a compressed thumbnail
            const thumbnailBuffer = await sharp(req.file.buffer)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 70 })
                .toBuffer();

            // Upload the compressed image to Cloudinary
            const [imageResult, thumbnailResult] = await Promise.all([
                new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { folder: 'CloudinaryDemo', format: 'jpg' },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    uploadStream.end(compressedImageBuffer);
                }),
                new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { folder: 'CloudinaryDemo', format: 'jpg' },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    uploadStream.end(thumbnailBuffer);
                })
            ]);

            const newProduct = new Product({
                name: req.body.name,
                title: req.body.title,
                description: req.body.description,
                image: imageResult.secure_url,
                thumbnail_image: thumbnailResult.secure_url,
                category_id: req.body.category_id
            });

            await newProduct.save();
            res.status(201).json({
                success: true,
                message: 'Product added successfully',
                product: newProduct
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Error processing upload',
            });
        }
    }
);

app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching products');
    }
});

// Validation middleware for update
const validateProductUpdate = [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().notEmpty().withMessage('Product name cannot be empty'),
    body('title').optional().notEmpty().withMessage('Product title cannot be empty'),
    body('description').optional().notEmpty().withMessage('Product description cannot be empty'),
    body('category_id').optional().notEmpty().withMessage('Category ID cannot be empty')
        .isMongoId().withMessage('Invalid category ID')
        .custom(async (value) => {
            const category = await Category.findById(value);
            if (!category) {
                throw new Error('Category not found');
            }
            return true;
        }),
];

// Update product route
app.put('/api/product/:id', 
    upload.single('image'),
    validateProductUpdate,
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                const errorsResponse = errors.array().reduce((acc, error) => {
                    if (!acc[error.param]) {
                        acc[error.param] = error.msg;
                    }
                    return acc;
                }, {});
                return res.status(400).json({
                    success: false,
                    errors: errorsResponse,
                    message: 'Validation failed'
                });
            }

            const product = await Product.findById(req.params.id);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            // Update text fields
            if (req.body.name) product.name = req.body.name;
            if (req.body.title) product.title = req.body.title;
            if (req.body.description) product.description = req.body.description;
            if (req.body.category_id) product.category_id = req.body.category_id;

            // Handle image update if a new image is uploaded
            if (req.file) {
                const allowedMimeTypes = ['image/jpeg', 'image/png'];
                if (!allowedMimeTypes.includes(req.file.mimetype)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid image format. Only JPEG and PNG are allowed.',
                        errors: { image: 'Invalid image format' }
                    });
                }

                // Compress the new image
                const compressedImageBuffer = await sharp(req.file.buffer)
                    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                // Create a new thumbnail
                const thumbnailBuffer = await sharp(req.file.buffer)
                    .resize(200, 200, { fit: 'cover' })
                    .jpeg({ quality: 70 })
                    .toBuffer();

                // Upload new images to Cloudinary
                const [imageResult, thumbnailResult] = await Promise.all([
                    new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { folder: 'CloudinaryDemo', format: 'jpg' },
                            (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            }
                        );
                        uploadStream.end(compressedImageBuffer);
                    }),
                    new Promise((resolve, reject) => {
                        const uploadStream = cloudinary.uploader.upload_stream(
                            { folder: 'CloudinaryDemo', format: 'jpg' },
                            (error, result) => {
                                if (error) reject(error);
                                else resolve(result);
                            }
                        );
                        uploadStream.end(thumbnailBuffer);
                    })
                ]);

                // Delete old images from Cloudinary
                if (product.image) {
                    await cloudinary.uploader.destroy(getPublicIdFromUrl(product.image));
                }
                if (product.thumbnail_image) {
                    await cloudinary.uploader.destroy(getPublicIdFromUrl(product.thumbnail_image));
                }

                // Update product with new image URLs
                product.image = imageResult.secure_url;
                product.thumbnail_image = thumbnailResult.secure_url;
            }

            await product.save();
            res.json({
                success: true,
                message: 'Product updated successfully',
                product: product
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Error updating product',
            });
        }
    }
);

// Delete product route
app.delete('/api/product/:id', 
    param('id').isMongoId().withMessage('Invalid product ID'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array(),
                    message: 'Validation failed'
                });
            }

            const product = await Product.findById(req.params.id);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            // Delete images from Cloudinary
            if (product.image) {
                await cloudinary.uploader.destroy(getPublicIdFromUrl(product.image));
            }
            if (product.thumbnail_image) {
                await cloudinary.uploader.destroy(getPublicIdFromUrl(product.thumbnail_image));
            }

            await Product.findByIdAndDelete(req.params.id);
            res.json({
                success: true,
                message: 'Product deleted successfully'
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Error deleting product',
            });
        }
    }
);
app.get('/api/product/:id', 
    param('id').isMongoId().withMessage('Invalid product ID'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array(),
                    message: 'Validation failed'
                });
            }

            const product = await Product.findById(req.params.id);
            if (!product) {
                return res.status(404).json({
                    success: false,
                    message: 'Product not found'
                });
            }

            
            res.json({
                success: true,
                message: 'Product fetched successfully',
                product: product
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({
                success: false,
                message: 'Error deleting product',
            });
        }
    }
);

// Helper function to extract public_id from Cloudinary URL
function getPublicIdFromUrl(url) {
    const parts = url.split('/');
    return parts[parts.length - 1].split('.')[0];
}


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});