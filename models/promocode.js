(function(){
  var mongoose = require('mongoose');
  var promoSchema = new mongoose.Schema({

    couponName: {
        type: String,
        trim: true,
        required: [true, 'couponName is required']
    },
    code: {
        type: String,
        trim: true,
        required: [true, 'code is required']
    },
    couponType: { 
        type: String,
        trim: true,
        required: [true, 'couponType is required']
    },
    discount: {
        type: String,
        trim: true,
        required: [true, 'discount is required']
    },
    amount: {
        type: String,
        trim: true,
        required: [true, 'amount is required']
    },
    startDate: {
        type: Date,
        trim: true,
        required: [true, 'startDate is required']
    },
    endDate: {
        type: Date,
        trim: true,
        required: [true, 'endDate is required']
    },
    status: {
        type: Boolean,
        required: true,
        default: true
    },
    created_date: { type: Date, default: Date.now }	,
    updated_date: { type: Date, default: Date.now }	

});
  
  var Promocode = mongoose.model('promocode', promoSchema);
  module.exports = Promocode;
})();
