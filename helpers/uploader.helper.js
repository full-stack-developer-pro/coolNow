const multer = require('multer');
const path = require('path')

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, 'public/uploads')
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname))
    }
})

const upload = multer({ storage: storage });

uploadSingle = function(field) {
    return upload.single(field);
};



module.exports = {
    uploadSingle
}