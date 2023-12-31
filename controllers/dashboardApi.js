const ManualUser = require('../models/user')
const soucreLead = require('../models/dashboardModel/leadSource')
const PromoCode = require('../models/promocode')
const mongoose = require('mongoose');
const techteam = require('../models/dashboardModel/techTeam');
const manualBooking = require('../models/dashboardModel/manualBooking');
const services = require('../models/serviceModel');
const banner = require('../models/dashboardModel/banner');
const supplier = require('../models/dashboardModel/supplier');
const skuModel = require('../models/dashboardModel/sku');
const stockModel = require('../models/dashboardModel/stock');
const stockOutModel = require('../models/stockOut');
const vehicleModel = require('../models/dashboardModel/vehicleModel');
const priorityModel = require('../models/dashboardModel/priorityModel');
const cartModel = require('../models/cartModel')
const zoneModel = require('../models/dashboardModel/zoneModel');
const districtModel = require('../models/dashboardModel/districtModel');
const appointmentModel = require('../models/appointment');
const package = require('../models/package');
var helper = require('../helper.js');
var moment = require('../node_modules/moment');
const uploadImage = require('../services/s3Services')
const taxRate = 8;

const getAvailableTeam =  async (location, startTime, endTime, bookingId  = null) => {
   
    if(location.pincode){

        //Find district id..
        var districts = await districtModel.findOne({
            postal_sectors: location.pincode.slice(0, 2)
        });

        if(districts._id){
            //find zones..
            var zones = await zoneModel.find({
                district: districts.id 
            });

            //find teams with slected zones..
            var zoneIds = zones.map((zone, index) => {
                return zone.id;
            })
             
            //Find teams working zone...
            if(zoneIds.length > 0){
                var techteams = await techteam.find({
                    selectZone: {
                        $in:  zoneIds
                    } 
                }).sort({ SelectPriority: 1 })

                if(techteams.length > 0){
                    var foundTeam = null;
                    for (const team of techteams) {
                        //Find team availibality in selected slot...
                        if(!foundTeam){
                            var isWhere = {
                                team_id: team._id,
                                $or: [
                                    { $and : [ 
                                        {
                                            "start_time": {
                                                $lte: new Date(startTime)
                                            }
                                        }, {
                                            "end_time": {
                                                $gte: new Date(startTime)
                                            }
                                        }
                                    ]},
                                    { $and : [
                                        {
                                            "start_time": {
                                                $lte: new Date(endTime)
                                            }
                                        }, {
                                            "end_time": {
                                                $gte: new Date(endTime)
                                            }
                                        }
                                    ]}   
                                ]
                            };
                            if(bookingId){
                                isWhere._id = {$ne : mongoose.Types.ObjectId(bookingId)}
                            }
                            var is_exists = await appointmentModel.find(isWhere)
                            if(is_exists.length == 0){
                                foundTeam = team; 
                            }
                        }
                    }

                    if(foundTeam && foundTeam._id){
                        return {
                            success: true,
                            team_id: foundTeam._id
                        } 
                    }
                }

                return {
                    success: false,
                    message: "No team(s) available at the moment!"
                }
            }
        }
    }

    return {
        success: false,
        message: "Address postal code is invalid!"
    }
        
}

const getUserCart = async (userId) => {
    return await cartModel.aggregate([
        {
          $lookup: {
        	from: "services",
        	localField: "servicesId",
        	foreignField: "_id",
        	as: "services"
          }
        },
        {
            $match: {
              "userId": mongoose.Types.ObjectId(userId)
            }
        }
    ]);
}

const calculateRateAndTime = async (carts) => {
    //Get total schedule time..
    var totalTime = 0;
    var totalPrice =  0;
    var items = [];
    if(carts.length > 0){
        await Promise.all(carts.map(async function(item, index){
            if(item.services.length > 0){
                await Promise.all(item.services.map(async function(service, index2){
                    if(service.sub_service.length > 0){
                        await Promise.all(service.sub_service.map(async function(sub_service, index3){
                            if(item.subServicesId.toString() == sub_service._id.toString()){
                                //check the unit and unit2 duration..
                                var duration = (sub_service.duration ? sub_service.duration : (service.duration ? service.duration : 0));
                                if(sub_service.duration_2 > 0 && item.numberOfunits > 1){
                                    var diff = sub_service.duration_2 - duration;
                                    duration  = (parseInt(duration) + parseInt(diff*(item.numberOfunits-1)));
                                }else{
                                    duration  = parseInt(duration*item.numberOfunits);
                                }
                                totalTime += duration;

                                //check rate..
                                var pp = null;
                                var price = (sub_service.price ? sub_service.price : (service.price ? service.price : 0));
                                if(item.packageId){
                                    //Find the package ID>>..
                                    var pp = await package.findById(item.packageId);
                                    if(pp && pp._id){
                                        if(pp.package_price && pp.package_price[item.numberOfunits]){
                                            price = parseInt((pp.package_price[item.numberOfunits]/item.numberOfunits));
                                        }else{
                                            price = parseInt((pp.unit_price*pp.services_count)); 
                                        }
                                    }
                                }else{
                                    if(sub_service.price_2 > 0 && item.numberOfunits > 1){
                                        price  =  parseInt((sub_service.price_2/2));
                                    } 
                                }                               
                                totalPrice += parseInt(price*item.numberOfunits);

                                const { services, ...rest } = item;
                                rest.price = price;
                                rest.duration = duration;
                                rest.package = pp;
                                items.push(rest);
                            }
                        }))
                    }
                }))
            }
        }));

        if(totalTime > 0){
            totalTime = totalTime+20;
            var reminder = totalTime%30;
            if(reminder != 0){
                totalTime = totalTime+(30-reminder);
            }
        }
    }
      
    return { duration: totalTime, price: totalPrice, items: items}
}

const getTimeStops = async (start, end, interval) => {
    var startTime = moment(start, 'HH:mm');
    var endTime = moment(end, 'HH:mm');
    var startTimeAlt = moment(start, 'HH:mm').add(interval, 'minutes');

    if( endTime.isBefore(startTime) ){
        endTime.add(1, 'day');
    }

    var timeStops = [];

    while(startTime < endTime && startTimeAlt <= endTime){
        timeStops.push([new moment(startTime).format('HH:mm'), new moment(startTime.add(interval, 'minutes')).format('HH:mm')]);
        startTimeAlt.add(interval, 'minutes');
    }

    return timeStops;
}

const getFormattedBooking = async (id) => {
    var appointment = await appointmentModel.findById(id);
    if(appointment && appointment.address_id){
        //Find address and append..
        var addressModel = helper.getModel("address");  
        appointment.address_details = await addressModel.findOne({_id: appointment.address_id});
    }
    return appointment;
}

//Add manualUser
module.exports.addManualUser = async (req, res) => {
    try {
        const { name, phone, email, gender, password, marketPlace, alias, leadSource, address, profile_photo } = req.body;
        if (name && email && phone && gender && password && marketPlace && alias && leadSource && address) {
            const dataInfo = await ManualUser.find({ email: email })
            if (dataInfo.length > 0) {
                res.send({ success: false, message: "Email Already Exists", data: null })
            } else {
                const manualUser = new ManualUser({
                    name: name,
                    email: email,
                    gender: gender,
                    password: password,
                    marketPlace: marketPlace,
                    alias: alias,
                    leadSource: leadSource,
                    address: address,
                    profile_photo: profile_photo,
                    phone: phone
                })
                await manualUser.save()
                res.send({ success: true, message: "User Add Successfully", data: manualUser })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//updateuser.........................................
module.exports.updateUser = async (req, res) => {
    try {
        const { name, phone, email, gender, marketPlace, alias, leadSource, address, profile_photo, _id } = req.body;
        if (name && email && phone && gender && marketPlace && alias && leadSource && address && profile_photo && _id) {
            const userData = await ManualUser.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name,
                        email: email,
                        gender: gender,
                        marketPlace: marketPlace,
                        alias: alias,
                        leadSource: leadSource,
                        address: address,
                        profile_photo: profile_photo,
                        phone: phone
                    }
                }
            );
            if (userData.modifiedCount === 1) {
                res.send({ success: true, message: "User Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "User Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//GetUserAll
module.exports.getAllUser = async (req, res) => {
    try {
        const userData = await ManualUser.find()
        if (userData.length > 0) {
            res.send({ success: true, message: "Get All User Successfully", data: userData })
        } else {
            res.send({ success: true, message: "Not Found User", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//DeleteUser
module.exports.deleteUser = async (req, res) => {
    try {
        const { _id } = req.body;
        const userData = await ManualUser.findOneAndDelete({ _id: _id })
        if (userData) {
            res.send({ success: true, message: "User Deleted Successfully", data: userData })
        } else {
            res.send({ success: true, message: "Not Found User", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getUserById
module.exports.getUserById = async (req, res) => {
    try {
        const { _id } = req.body;
        const userData = await ManualUser.findById({ _id: _id })
        if (userData) {
            res.send({ success: true, message: "Get User Details Successfully", data: userData })
        } else {
            res.send({ success: true, message: "Not Found User", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addLead Source
module.exports.addLead = async (req, res) => {
    try {
        const { name, date, whoCreated } = req.body;
        if (name && date && whoCreated) {
            const leadUser = new soucreLead({
                name: name,
                date: date,
                whoCreated: whoCreated,

            })
            await leadUser.save()
            res.send({ success: true, message: "Lead Add Successfully", data: leadUser })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//updateLead Source
module.exports.updateLead = async (req, res) => {
    try {
        const { name, date, whoCreated, _id } = req.body;
        if (name && date && whoCreated && _id) {
            const leadData = await soucreLead.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name,
                        date: date,
                        whoCreated: whoCreated
                    }
                }
            );
            if (leadData.modifiedCount === 1) {
                const data =  await soucreLead.find({_id:_id})
                res.send({ success: true, message: "Lead Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Lead Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//list LeadSource.......................................
module.exports.getAllLead = async (req, res) => {
    try {
        const leadData = await soucreLead.find()
        if (leadData.length > 0) {
            res.send({ success: true, message: "Get All Lead Successfully", data: leadData })
        } else {
            res.send({ success: true, message: "Not Found Lead", data: leadData })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteLeadSource.....................................
module.exports.deleteLead = async (req, res) => {
    try {
        const { _id } = req.body;
        const leadData = await soucreLead.findOneAndDelete({ _id: _id })
        if (leadData) {
            res.send({ success: true, message: "Lead Delete Successfully", data: leadData })
        } else {
            res.send({ success: false, message: "Lead Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addCoupon.....................................
module.exports.addCouponsPromoCode = async (req, res) => {
    try {
        const { couponName, code, couponType, discount, amount, startDate, endDate, status } = req.body;
        if (couponName && code && couponType && discount & amount && startDate && endDate && status) {
            const promoCode = new PromoCode({
                couponName: couponName,
                code: code,
                couponType: couponType,
                discount: discount,
                amount: amount,
                startDate: startDate,
                endDate: endDate,
                status: status
            })
            await promoCode.save()
            res.send({ success: true, message: "Promo Code Add Successfully", data: promoCode })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//updatedCoupon
module.exports.updateCouponsPromoCode = async (req, res) => {
    try {
        const { couponName, code, couponType, discount, amount, startDate, endDate, status, _id } = req.body;
        if (couponName && code && couponType && discount & amount && startDate && endDate && status) {
            const couponData = await PromoCode.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        couponName: couponName,
                        code: code,
                        couponType: couponType,
                        discount: discount,
                        amount: amount,
                        startDate: startDate,
                        endDate: endDate,
                        status: status
                    }
                }
            );
            if (couponData.modifiedCount === 1) {
                const data =  await PromoCode.find({_id:_id})
                res.send({ success: true, message: "Promo Code Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Promo Code Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//list LeadSource.......................................
module.exports.getAllPromoCodeCoupon = async (req, res) => {
    try {
        const promoata = await PromoCode.find()
        if (promoata.length > 0) {
            res.send({ success: true, message: "Get All Promo Code Successfully", data: promoata })
        } else {
            res.send({ success: true, message: "Not Found Promo Code", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteLeadSource.....................................
module.exports.deletePromoCodeCoupon = async (req, res) => {
    try {
        const { _id } = req.body;
        const leadData = await PromoCode.findOneAndDelete({ id: _id })
        if (leadData) {
            res.send({ success: true, message: "Promo Code Delete Successfully", data: leadData })
        } else {
            res.send({ success: false, message: "Promo Cod Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//addTechTeam.................................
module.exports.addTechTeam = async (req, res) => {
    try {
        const { memberId, leaderId, driverId, teamNme, Vehicle, selectZone, SelectPriority, days } = req.body;
        if (memberId && leaderId && driverId && teamNme && Vehicle && selectZone && SelectPriority && days) {
            const techInfo = new techteam({
                memberId: memberId,
                leaderId: leaderId,
                driverId: driverId,
                teamNme: teamNme,
                Vehicle: Vehicle,
                selectZone: selectZone,
                SelectPriority: SelectPriority,
                days: days
            })
            await techInfo.save()
            res.send({ success: true, message: "Tech Team Added Successfully", data: techInfo })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//updatedCoupon
module.exports.updateTechTeam = async (req, res) => {
    try {
        const { memberId, leaderId, driverId, teamNme, Vehicle, selectZone, SelectPriority, _id, days } = req.body;
        if (memberId && leaderId && driverId && teamNme && Vehicle && selectZone && SelectPriority && days) {
            const techData = await techteam.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        memberId: memberId,
                        leaderId: leaderId,
                        driverId: driverId,
                        teamNme: teamNme,
                        Vehicle: Vehicle,
                        selectZone: selectZone,
                        SelectPriority: SelectPriority,
                        days: days
                    }
                }
            );
            if (techData.modifiedCount === 1) {
                const data =  await techteam.find({_id:_id})
                res.send({ success: true, message: "Tech Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Tech  Does't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//list TechTeam.......................................
module.exports.getAllTechTeam = async (req, res) => {
    try {
        // const techData = await techteam.find()
        const techData = await techteam.aggregate([
            {
                $match: {
                    _id: { $exists: true } // Optional: Add any additional match conditions here
                }
            },
            {
                $lookup: {
                    from: "users",
                    localField: "memberId",
                    foreignField: "_id",
                    as: "datainfo"
                }
            },
            {$unwind: {
				"path": "$datainfo",
				"preserveNullAndEmptyArrays": true
			}},
            {
                $group: {
                    _id: "$_id",
                    teamNme: { $first: "$teamNme" },
                    memberId: { $first: "$memberId" },
                    leaderId: { $first: "$leaderId" },
                    driverId: { $first: "$driverId" },
                    days: { $first: "$days" },
                    Vehicle: { $first: "$Vehicle" },
                    selectZone: { $first: "$selectZone" },
                    SelectPriority: { $first: "$SelectPriority" },
                    datainfo: { $push: "$datainfo.name" }
                }
            }
        ]);
        if (techData.length > 0) {
            res.send({ success: true, message: "Get All TechTeam Successfully", data: techData })
        } else {
            res.send({ success: true, message: "Not Found TeachTeam", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteTechTeam.....................................
module.exports.deleteTechTeam = async (req, res) => {
    try {
        const { _id } = req.body;
        const leadData = await techteam.findOneAndDelete({ id: _id })
        if (leadData) {
            res.send({ success: true, message: "TechTeam Delete Successfully", data: leadData })
        } else {
            res.send({ success: false, message: "TechTeam Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

module.exports.manualBooking = async (req, res) => {
    try {
        const { userName, technician_id, phone, email, date, address, bookingSlot, chooseServices, note } = req.body;
        if (userName && technician_id && phone && email && date && address && bookingSlot && chooseServices && note) {
            const BookingInfo = new manualBooking({
                userName: userName,
                technician_id: technician_id,
                email: email,
                date: date,
                phone: phone,
                address: address,
                bookingSlot: bookingSlot,
                chooseServices: chooseServices,
                note: note
            })
            await BookingInfo.save()
            res.send({ success: true, message: "Manual Booking  Add Successfully", data: BookingInfo })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updatedManualBooking
module.exports.updatedManualBooking = async (req, res) => {
    try {
        const { userName, phone, email, date, address, bookingSlot, chooseServices, note, technician_id, _id } = req.body;
        if (userName && technician_id && phone && email && date && address && bookingSlot && chooseServices && _id && note) {
            const manualData = await manualBooking.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        userName: userName,
                        technician_id: technician_id,
                        email: email,
                        date: date,
                        phone: phone,
                        address: address,
                        bookingSlot: bookingSlot,
                        chooseServices: chooseServices,
                        note: note
                    }
                })
            if (manualData.modifiedCount === 1) {
                const data =  await manualBooking.find({_id:_id})
                res.send({ success: true, message: "Manual Booking  Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Manual Booking Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//list TechTeam.......................................
module.exports.getAllManualBooking = async (req, res) => {
    try {
        const bookingData = await manualBooking.find()
        if (bookingData.length > 0) {
            res.send({ success: true, message: "Get All ManualBooking Successfully", data: bookingData })
        } else {
            res.send({ success: true, message: "Not Found ManualBooking", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteTechTeam.....................................
module.exports.deleteManualBooking = async (req, res) => {
    try {
        const { _id } = req.body;
        const leadData = await manualBooking.findOneAndDelete({ id: _id })
        if (leadData) {
            res.send({ success: true, message: "ManualBooking Delete Successfully", data: leadData })
        } else {
            res.send({ success: false, message: "ManualBooking Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


// //addServices.................
// module.exports.addServices = async (req,res) => {
//     try {
//         const { title, description, sub_service,price,commision_margin,commision_amount,cost,icon,status} = req.body;
//         if(title && description  && sub_service && price && commision_margin && commision_amount && cost && icon  && status){
//         const ServicesInfo = new services({
//             title: title,
//             description: description,
//             sub_service:sub_service,
//             price:price,
//             commision_margin:commision_margin,
//             commision_amount:commision_amount,
//             cost:cost,
//             icon:icon,
//             status:status
//       })
//             await ServicesInfo.save()
//     res.send({ success: true, message: "Service Add Successfully", data: ServicesInfo })
//     }else{
//     res.send({ success: false, message: "All Fields Are Required", data: null })
//     }
//     } catch (err) {
//         res.send({ success: false, message: "Internal Server Error", data: null })
//     }
// }

//addServices.................
module.exports.addServices = async (req, res) => {
    try{
        if (!req.body) {
            res.json({
                success: false,
                message: 'Form data is missing',
                data : null
            });
            res.end();
        }

        var posted_data = {};
        posted_data.title = req.body.title || "";
        posted_data.description = req.body.description || "";
        posted_data.image = req.body.image || "";
        posted_data.banner_image = req.body.banner_image || ""; 
        posted_data.cost = req.body.cost || "";
        posted_data.price = req.body.price || ""; 
        posted_data.duration = req.body.duration || ""; 
        posted_data.price_2 = req.body.price_2 || "";
        posted_data.duration_2 = req.body.duration_2 || "";
        posted_data.commision_margin = req.body.commision_margin || "";
        posted_data.commision_amount = req.body.commision_amount || "";
        posted_data.sub_service = req.body.sub_service || "";
        posted_data.status = req.body.status || "";
        if (!posted_data.title || !posted_data.description || !posted_data.image  || !posted_data.banner_image  || !posted_data.sub_service || !posted_data.sub_service[0].title || !posted_data.sub_service[0].duration || !posted_data.sub_service[0].price) {
            res.json({
                success: false,
                message: "Required parameter is missing (title|description|image|banner_image|sub_service.title|sub_service.duration|sub_service.price)",
                data : null
            });
            res.end();
            return;
        }
        var newService = new services(posted_data);
        newService.save(function(errors, dbres) {
            //console.log("errors", errors)
            if(errors){
                res.json({
                    success: false,
                    message: "Something went wrong, please try again",
                    data : errors
                });
                res.end();
                return;
            } else {
                res.json({
                    success: true,
                    message: 'Service Added Successfully!',
                    data: dbres,
                });
                res.end();
                return;
            }
        })
    }catch(err){
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}

//getServicesById
module.exports.getServicesById = async (req, res) => {
    try {
        var serviceId = mongoose.Types.ObjectId(req.params.id);
        if (!serviceId) {
            res.json({
                success: false,
                message: 'serviceId parameter is missing in URL',
                data: null
            });
            res.end();
        }
        const servicesData = await services.findById({ _id: serviceId })
        if (servicesData) {
            res.send({ success: true, message: "Get Services Details Successfully", data: servicesData })
        } else {
            res.send({ success: true, message: "Not Found Services", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//getServicesPackage
module.exports.getServicesPackage = async (req, res) => {
    try {
        var subServiceId = mongoose.Types.ObjectId(req.params.id);
        if (!subServiceId) {
            res.json({
                success: false,
                message: 'subServiceId parameter is missing in URL',
                data: null
            });
            res.end();
        }
        const servicesData = await package.find({ subServicesId : subServiceId, services_count : { '$gt' : 1}})
        if (servicesData.length > 0) {
            res.send({ success: true, message: "Get packages successfully!", data: servicesData })
        } else {
            res.send({ success: true, message: "No package found!", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updatedServices.....................
module.exports.updatedServices = async (req, res) => {
    try {
        var serviceId = mongoose.Types.ObjectId(req.params.id);
        if (!serviceId) {
            res.json({
                success: false,
                message: 'serviceId parameter is missing in URL',
                data: null
            });
            res.end();
        }

        if (!req.body) {
            res.json({
                success: false,
                message: 'Form data is missing',
                data : null
            });
            res.end();
        }

        if (!req.body.title || !req.body.description || !req.body.image  || !req.body.banner_image  || !req.body.sub_service || !req.body.sub_service[0].title || !req.body.sub_service[0].duration || !req.body.sub_service[0].price) {
            res.json({
                success: false,
                message: "Required parameter is missing (title|description|image|banner_image|sub_service.title|sub_service.duration|sub_service.price)",
                data : null
            });
            res.end();
            return;
        }
        req.body.updated_at = new Date();
        services.findOneAndUpdate({_id: serviceId}, {"$set": req.body}, {new: false}, async function(errors, dbres){
            //console.log("errors", errors)
            if(errors){
                res.json({
                    success: false,
                    message: "Something went wrong, please try again",
                    data : errors
                });
                res.end();
                return;
            } else {
                // return the information including token as JSON
                res.json({
                    success: true,
                    message: (dbres ? 'Service updated successfully!' : "Nothing to update!"),
                    data: await services.findById({ _id: serviceId }),
                });
                res.end();
                return;
            }
        })
    }catch(err){
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}
 
//list services.......................................
module.exports.getServices = async (req, res) => {
    try {
        const servicesData = await services.find()
        if (servicesData.length > 0) {
            res.send({ success: true, message: "Get All Services Successfully", data: servicesData })
        } else {
            res.send({ success: true, message: "Not Found Services", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

module.exports.getAllServices = async (req, res) => {
    try {
        const bannerData = await banner.find()
        const bannerImage = bannerData[0].banner_image
        const servicesData = await services.find()
        if (servicesData.length > 0) {
            res.send({ success: true, message: "Get All Services Successfully",bannerData:bannerData, data: servicesData })
        } else {
            res.send({ success: true, message: "Not Found Services", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteServices.....................................
module.exports.deleteServices = async (req, res) => {
    try{
        var serviceId = mongoose.Types.ObjectId(req.params.id);
        if (!serviceId) {
            res.json({
                success: false,
                message: 'serviceId parameter is missing in URL',
                data: null
            });
            res.end();
        }

        const deleteData = await services.findByIdAndDelete(serviceId);
        if (deleteData) {
            res.send({ success: true, message: "Service Deleted Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Service Don't Deleted", data: null })
        }
    }catch(err){
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}
 
module.exports.addBanner = async (req, res) => {
    try {
        const { banner_title, banner_description, banner_image, active, scheduleDate, scheduleTime } = req.body;
        if (banner_title && banner_description && banner_image && active, scheduleDate, scheduleTime) {

            var scheduleTimeString = scheduleDate+" "+scheduleTime+":00";
            var scheduleTimeFormat = moment(scheduleTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');

            const bannerInfo = new banner({
                banner_title: banner_title,
                banner_description: banner_description,
                banner_image: banner_image,
                active: active,
                scheduleDateTime: new Date(scheduleTimeFormat),
            })
            await bannerInfo.save()
            res.send({ success: true, message: "Banner Added Successfully!", data: bannerInfo })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updatedBanner
module.exports.updatedBanner = async (req, res) => {
    try {
        const { banner_title, banner_description, banner_image, active, scheduleDate, scheduleTime, _id } = req.body;
        if (banner_title && banner_description && banner_image && active, scheduleDate, scheduleTime) {

            var scheduleTimeString = scheduleDate+" "+scheduleTime+":00";
            var scheduleTimeFormat = moment(scheduleTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');

            const bannerData = await banner.updateOne(
                { _id: _id },
                {
                    $set: {
                        banner_title: banner_title,
                        banner_description: banner_description,
                        banner_image: banner_image,
                        active: active,
                        scheduleDateTime: new Date(scheduleTimeFormat),
                    }
                })
            if (bannerData.modifiedCount === 1) {
                const bannerData1 = await banner.findById({ _id: _id })
                res.send({ success: true, message: "Banner Updated Successfully!", data: bannerData1 })
            } else {
                res.send({ success: false, message: "Nothing to update", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: err })
    }
}

//list banner.......................................
module.exports.getAllBanner = async (req, res) => {
    try {
        const bannerData = await banner.find()
        if (bannerData.length > 0) {
            res.send({ success: true, message: "Get All Banner Successfully", data: bannerData })
        } else {
            res.send({ success: true, message: "Not Found Banner", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deletebanner.....................................
module.exports.deleteBanner = async (req, res) => {
    try {
        const { _id } = req.body;
        const deleteData = await banner.findOneAndDelete({ id: _id })
        if (deleteData) {
            res.send({ success: true, message: "Banner Delete Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Banner Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//addSupplier......................
module.exports.addSupplier = async (req, res) => {
    try {
        const { companyName, email, contactPerson, mobileNumber, uenNumber, notes, address } = req.body;
        if (companyName && email && contactPerson && mobileNumber && uenNumber && address && notes) {
            const addSupplier = new supplier({
                companyName: companyName,
                email: email,
                contactPerson: contactPerson,
                mobileNumber: mobileNumber,
                uenNumber: uenNumber,
                address: address,
                notes: notes,
            })
            await addSupplier.save()
            res.send({ success: true, message: "Suppiler Add Successfully", data: addSupplier })
        }
        else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updateSupplier.............................
module.exports.updatedSupplier = async (req, res) => {
    try {
        const { companyName, email, contactPerson, mobileNumber, uenNumber, notes, address, _id } = req.body;
        if (companyName && email && contactPerson && mobileNumber && uenNumber && address && notes && _id) {
            const supplierData = await suplier.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        companyName: companyName,
                        email: email,
                        contactPerson: contactPerson,
                        mobileNumber: mobileNumber,
                        uenNumber: uenNumber,
                        address: address,
                        notes: notes,
                    }
                })
            if (supplierData.modifiedCount === 1) {
                res.send({ success: true, message: "Supplier Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Supplier Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//list Supplier.......................................
module.exports.getAllSupplier = async (req, res) => {
    try {
        const supplierData = await suplier.find()
        if (supplierData.length > 0) {
            res.send({ success: true, message: "Get All Supplier Successfully", data: supplierData })
        } else {
            res.send({ success: true, message: "Not Found Supplier", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//deletesupplier....................................
module.exports.deleteSupplier = async (req, res) => {
    try {
        const { _id } = req.body;
        const deleteData = await supplier.findOneAndDelete({ id: _id })
        if (deleteData) {
            res.send({ success: true, message: "Supplier Delete Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Supplier Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//addTechnician
module.exports.addTechnician = async (req, res) => {
    try {
        const { name, phone, email, password, profile_photo, designation, skill } = req.body;
        if (name && email && phone && password && skill && designation && profile_photo) {
            const dataInfo = await ManualUser.find({ email: email })
            if (dataInfo.length > 0) {
                res.send({ success: false, message: "Email Already Exists", data: null })
            } else {
                const technicianData = new ManualUser({
                    name: name,
                    email: email,
                    password: password,
                    designation: designation,
                    skill: skill,
                    profile_photo: profile_photo,
                    phone: phone,
                    user_type: "T"
                })
                await technicianData.save()
                res.send({ success: true, message: "Technician Add Successfully", data: technicianData })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updateTechnician.........................................
module.exports.updateTechnician = async (req, res) => {
    try {
        const { name, phone, email, profile_photo, designation, skill, _id } = req.body;
        if (name && email && phone && skill && designation && profile_photo && _id) {
            const technicianData = await ManualUser.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name,
                        email: email,
                        designation: designation,
                        skill: skill,
                        profile_photo: profile_photo,
                        phone: phone,
                    }
                }
            );
            if (technicianData.modifiedCount === 1) {
                res.send({ success: true, message: "Technician Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Technician Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllTechnician
module.exports.getAllTechnician = async (req, res) => {
    try {
        const technicianData = await ManualUser.find({ user_type: "T" })
        if (technicianData.length > 0) {
            res.send({ success: true, message: "Get All Technician Successfully", data: technicianData })
        } else {
            res.send({ success: true, message: "Not Found Technician", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//deleteTechnician
module.exports.deleteTechnician = async (req, res) => {
    try {
        const { _id } = req.body;
        const technicianData = await ManualUser.findOneAndDelete({ _id: _id })
        if (technicianData) {
            res.send({ success: true, message: "Technician Deleted Successfully", data: technicianData })
        } else {
            res.send({ success: true, message: "Not Found Technician", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getByIdTechnician
module.exports.getTechnicianById = async (req, res) => {
    try {
        const { _id } = req.body;
        const technicianData = await ManualUser.findById({ _id: _id })
        if (technicianData) {
            res.send({ success: true, message: "Get Technician Details Successfully", data: technicianData })
        } else {
            res.send({ success: true, message: "Not Found Technician", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getLeadById
module.exports.getLeadById = async (req, res) => {
    try {
        const { _id } = req.body;
        const leadData = await soucreLead.findById({ _id: _id })
        if (leadData) {
            res.send({ success: true, message: "Get SourceLead Details Successfully", data: leadData })
        } else {
            res.send({ success: true, message: "Not Found SourceLead", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getbyIdPromocode...............
module.exports.getPromocodeById = async (req, res) => {
    try {
        const { _id } = req.body;
        const Data = await promoCode.findById({ _id: _id })
        if (Data) {
            res.send({ success: true, message: "Get promoCode Details Successfully", data: Data })
        } else {
            res.send({ success: true, message: "Not Found promoCode", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getByIdTechTeam...........................
module.exports.getTechTeamById = async (req, res) => {
    try {
        const { _id } = req.body;
        const teamData = await techteam.findById({ _id: _id })
        if (teamData) {
            res.send({ success: true, message: "Get TechTeam Details Successfully", data: teamData })
        } else {
            res.send({ success: true, message: "Not Found TechTeam", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getByIdmanualbooking...........................
module.exports.getyByIdManualbooking = async (req, res) => {
    try {
        const { _id } = req.body;
        const bookingData = await manualBooking.findById({ _id: _id })
        if (bookingData) {
            res.send({ success: true, message: "Get manualbooking Details Successfully", data: bookingData })
        } else {
            res.send({ success: true, message: "Not Found manualbooking", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getByidServices
module.exports.getyByIdServices = async (req, res) => {
    try {
        const { _id } = req.body;
        const servicesData = await services.findById({ _id: _id })
        if (servicesData) {
            res.send({ success: true, message: "Get Services Details Successfully", data: servicesData })
        } else {
            res.send({ success: true, message: "Not Found Services", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getbyIdBybanner
module.exports.getyByIdbanner = async (req, res) => {
    try {
        const { _id } = req.body;
        const bannerData = await banner.findById({ _id: _id })
        if (bannerData) {
            res.send({ success: true, message: "Get Banner Details Successfully", data: bannerData })
        } else {
            res.send({ success: true, message: "Not Found Banner", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getbyIdSupplier
module.exports.getyByIdSupplier = async (req, res) => {
    try {
        const { _id } = req.body;
        const supplierData = await supplier.findById({ _id: _id })
        if (supplierData) {
            res.send({ success: true, message: "Get Supplier Details Successfully", data: supplierData })
        } else {
            res.send({ success: true, message: "Not Found Supplier", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//Add Sku
module.exports.addSku = async (req, res) => {
    try {
        const { skuNumber, name, supplier, category, description, cost, costwithgst } = req.body;
        if (name && skuNumber && supplier && category && description && cost && costwithgst) {
            const sku = new skuModel({
                name: name,
                skuNumber: skuNumber,
                supplier: supplier,
                category: category,
                description: description,
                cost: cost,
                costwithgst: costwithgst,
            })
            await sku.save()
            res.send({ success: true, message: "Sku Add Successfully", data: sku })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updateSku
module.exports.updatedSku = async (req, res) => {
    try {
        const { skuNumber, name, supplier, category, description, cost, costwithgst, _id } = req.body;
        if (name && skuNumber && supplier && category && description && cost && costwithgst) {
            const skuData = await skuModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name,
                        skuNumber: skuNumber,
                        supplier: supplier,
                        category: category,
                        description: description,
                        cost: cost,
                        costwithgst: costwithgst,
                    }
                })
            if (skuData.modifiedCount === 1) {
                const data =  await skuModel.find({_id:_id})
                res.send({ success: true, message: "Sku Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Sku Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllSku..................
module.exports.getAllSku = async (req, res) => {
    try {
        const skuData = await skuModel.find()
        if (skuData.length > 0) {
            res.send({ success: true, message: "Get All Sku Successfully", data: skuData })
        } else {
            res.send({ success: true, message: "Not Found Sku", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addStock...............................................
module.exports.addStock = async (req, res) => {
    try {
        const { selectSku, selectQuantity, date } = req.body;
        if (selectSku && selectQuantity && date) {
            const sku = new stockModel({
                selectSku: selectSku,
                selectQuantity: selectQuantity,
                date: date,
            })
            await sku.save()
            res.send({ success: true, message: "Stock Add Successfully", data: sku })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updateSku
module.exports.updatedStock = async (req, res) => {
    try {
        const { selectSku, selectQuantity, date, _id } = req.body;
        if (selectSku && selectQuantity && date, _id) {
            const Stock = await stockModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        selectSku: selectSku,
                        selectQuantity: selectQuantity,
                        date: date,
                    }
                })
            if (Stock.modifiedCount === 1) {
                const data =  await stockModel.find({_id:_id})
                res.send({ success: true, message: "Stock Updated Successfully", data: data })
            } else {
                res.send({ success: false, message: "Stock Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllStock..................
module.exports.getAllStock = async (req, res) => {
    try {
        const stockData = await stockModel.find()
        if (stockData.length > 0) {
            res.send({ success: true, message: "Get All Stock Successfully", data: stockData })
        } else {
            res.send({ success: true, message: "Not Found Stock", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//addStockout...............................................
module.exports.addStockOut = async (req, res) => {
    try {
        const { jobOrder, receiverName, jobNature, issuedBy, totalMaterialCost } = req.body;
        if (jobOrder && receiverName && jobNature && issuedBy && totalMaterialCost) {
            const skuOut = new stockOutModel({
                jobOrder: jobOrder,
                receiverName: receiverName,
                jobNature: jobNature,
                issuedBy: issuedBy,
                totalMaterialCost: totalMaterialCost
            })
            await skuOut.save()
            res.send({ success: true, message: "StockOut  Add Successfully", data: skuOut })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addVehicle...............................................
module.exports.addvehicle = async (req, res) => {
    try {
        const { vehicleName, vehicleBrand, driver } = req.body;
        if (vehicleName && vehicleBrand && driver) {
            const vehicle = new vehicleModel({
                vehicleName: vehicleName,
                vehicleBrand: vehicleBrand,
                driver: driver,
            })
            await vehicle.save()
            res.send({ success: true, message: "Vehicle Add Successfully", data: vehicle })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

// updateVehicle......................

module.exports.updatedVehicle = async (req, res) => {
    try {
        const { vehicleName, vehicleBrand, driver, _id } = req.body;
        if (vehicleName && vehicleBrand && driver, _id) {
            const vehicleUpdate = await vehicleModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        vehicleName: vehicleName,
                        vehicleBrand: vehicleBrand,
                        driver: driver,
                    }
                })
            if (vehicleUpdate.modifiedCount === 1) {
                res.send({ success: true, message: "Vehicle Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Vehicle Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//deleteVehicle
module.exports.deleteVehicle = async (req, res) => {
    try {
        const { _id } = req.body;
        const deleteData = await vehicleModel.findOneAndDelete({ id: _id })
        if (deleteData) {
            res.send({ success: true, message: "Vehicle Delete Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Vehicle Does'nt Delete", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getAllVehicle
module.exports.getAllVehicle = async (req, res) => {
    try {
        const VehicleData = await vehicleModel.find()
        if (VehicleData.length > 0) {
            res.send({ success: true, message: "Get All Vehicle Successfully", data: VehicleData })
        } else {
            res.send({ success: true, message: "Not Found Vehicle", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}
//getbyIdVehicle
module.exports.getyByIdVehicle = async (req, res) => {
    try {
        const { _id } = req.body;
        const VehicleData = await vehicleModel.findById({ _id: _id })
        if (VehicleData) {
            res.send({ success: true, message: "Get Vehicle Details Successfully", data: VehicleData })
        } else {
            res.send({ success: true, message: "Not Found Vehicle", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllPriorities
module.exports.getAllPriorities = async (req, res) => {
    try {
        const data = await priorityModel.find()
        if (data.length > 0) {
            res.send({ success: true, message: "Get All Priorities Successfully", data: data })
        } else {
            res.send({ success: true, message: "Not Found Priorities", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addPriorities...............................................
module.exports.addPriorities = async (req, res) => {
    try {
        const { name } = req.body;
        if (name) {
            const priority = new priorityModel({
                name: name,
            })
            await priority.save()
            res.send({ success: true, message: "Priority Added Successfully", data: priority })
        } else {
            res.send({ success: false, message: "Name is Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

// updatedPriorities......................
module.exports.updatedPriorities = async (req, res) => {
    try {
        const { _id } = req.params;
        const { name } = req.body;
        if (name) {
            const priorityUpdate = await priorityModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name
                    }
                }
            )
            if (priorityUpdate.modifiedCount === 1) {
                res.send({ success: true, message: "Priority Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Priority Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "Name is Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//deletePriorities
module.exports.deletePriorities = async (req, res) => {
    try {
        const { _id } = req.params;
        const deleteData = await priorityModel.findByIdAndDelete(_id)
        if (deleteData) {
            res.send({ success: true, message: "Priority Deleted Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Priority Don't Deleted", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllZones
module.exports.getAllZones = async (req, res) => {
    try {
        const data = await zoneModel.find()
        if (data.length > 0) {
            res.send({ success: true, message: "Get All Zones Successfully", data: data })
        } else {
            res.send({ success: true, message: "Not Found Zones", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addZones...............................................
module.exports.addZones = async (req, res) => {
    try {
        const { name, zoneId, district } = req.body;
        if (name && zoneId && district) {
            const zone = new zoneModel({
                name: name,
                zoneId: zoneId,
                district:  district 
            })
            await zone.save()
            res.send({ success: true, message: "Zone Added Successfully", data: zone })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

// updatedZones......................
module.exports.updatedZones = async (req, res) => {
    try {
        const { _id } = req.params;
        const { name, zoneId, district } = req.body;
        if (name && zoneId && district) {
            const zoneUpdate = await zoneModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        name: name,
                        zoneId: zoneId,
                        district:  district 
                    }
                }
            )
            if (zoneUpdate.modifiedCount === 1) {
                res.send({ success: true, message: "Zone Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Zone Don't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//deleteZones
module.exports.deleteZones = async (req, res) => {
    try {
        const { _id } = req.params;
        const deleteData = await zoneModel.findByIdAndDelete(_id)
        if (deleteData) {
            res.send({ success: true, message: "Zone Deleted Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Zone Don't Deleted", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllZones
module.exports.getAllDistricts = async (req, res) => {
    try {
        const data = await districtModel.find()
        if (data.length > 0) {
            res.send({ success: true, message: "Get All Districts Successfully", data: data })
        } else {
            res.send({ success: true, message: "Not Found Districts", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllZones
module.exports.getAllDistrictsLocations = async (req, res) => {
    try {
        const data = await districtModel.find()
        if (data.length > 0) {
            var locationArr = [];
            data.map(function(key, value){
                key.locations.map(function(key1, value1){
                    locationArr.push(key1);
                })
            });
            res.send({ success: true, message: "Get All District Locations Successfully", data: locationArr })
        } else {
            res.send({ success: true, message: "Not Found Districts", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//addZones...............................................
module.exports.addDistricts = async (req, res) => {
    try {
        const { postal_district, postal_sectors, locations } = req.body;
        if (postal_district && postal_sectors && locations) {
            const district = new districtModel({
                postal_district: postal_district,
                postal_sectors: postal_sectors,
                locations:  locations 
            })
            await district.save()
            res.send({ success: true, message: "Zone Added Successfully", data: district })
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//Appointment Slots...............................................
module.exports.appointmentsSlots = async (req, res) => {
    try {
        const { body } = req;
        
        if (!req.body) {
            res.json({
                success: false,
                message: 'Form data is missing',
                data : null
            });
            res.end();
        }

        if (!body.user_id || !body.address_id || !body.date) {
            res.json({
                success: false,
                message: "All parameters are required (user_id|address_id|date)",
                data : null
            });
            res.end();
            return;
        }

        //find user cart..
        var carts = await getUserCart(body.user_id);
        if(carts.length == 0){
            res.json({
                success: false,
                message: "User cart is empty!",
                data : null
            });
            res.end();
            return;
        }

        //find address..
        var addressModel = helper.getModel("address");  
        var address = await addressModel.findOne({_id: body.address_id});
       
        if(address._id && address.user_id == body.user_id){
            
            //Get total schedule time..
            var availableSlots = [];
            var data = await calculateRateAndTime(carts);
            var totalTime = (data.duration ? data.duration : 0);

            //Make slots..
            if(totalTime > 0){
                var slots = await getTimeStops("09:00", "17:00", totalTime);
                await Promise.all(slots.map(async function(slot, index){
    
                    //Make time slots..
                    var currentTime = moment().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
                    var startTimeString = `${body.date} ${slot[0]}:00`;
                    var startTimeFormat = moment(startTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
                    var endTimeString = `${body.date} ${slot[1]}:00`;
                    var endTimeFormat = moment(endTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
    
                    //Get available team..
                    if(startTimeFormat >= currentTime){
                        var teamId = await getAvailableTeam(address, startTimeFormat, endTimeFormat);
                        if(teamId.success && teamId.team_id){
                            availableSlots.push({team_id: teamId.team_id, slot: slot, slot_formated : moment(slot[0], 'HH:mm').format('hh:mm A') + " - "+ moment(slot[1], 'HH:mm').format('hh:mm A')})
                        }
                    } 
                }));
            }
  
            if(availableSlots.length > 0){
                res.json({
                    success: true,
                    message: 'List of available slots!',
                    data: availableSlots.sort(function (a, b) {
                        return a.slot[0].localeCompare(b.slot[0]);
                    }),
                });
                res.end();
                return;
            }else{
                res.json({
                    success: false,
                    message: "No slots available!",
                    data : null
                });
                res.end();
                return;
            }
           
        }else{
            res.json({
                success: false,
                message: "User address is invalid!",
                data : null
            });
            res.end();
            return;
        }
       

    } catch (err) {
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}

//Appointment Draft...............................................
module.exports.draftAppointments = async (req, res) => {
    try {
        const { body } = req;
        
        if (!req.body) {
            res.json({
                success: false,
                message: 'Form data is missing',
                data : null
            });
            res.end();
        }

        if (!body.user_id || !body.address_id || !body.date || !body.slot) {
            res.json({
                success: false,
                message: "All parameters are required (user_id|address_id|date|slot)",
                data : null
            });
            res.end();
            return;
        }

        //find user cart..
        var carts = await getUserCart(body.user_id);
        if(carts.length == 0){
            res.json({
                success: false,
                message: "User cart is empty!",
                data : null
            });
            res.end();
            return;
        }
        
        //find address..
        var addressModel = helper.getModel("address");  
        var address = await addressModel.findOne({_id: body.address_id});
       
        if(address._id && address.user_id == body.user_id){
           
            //Delete old drafts..
            await appointmentModel.deleteMany({user_id : body.user_id, 'status' : 'draft'});
 
            //Make time slots..
            var startTimeString = `${body.date} ${body.slot[0]}:00`;
            var startTimeFormat = moment(startTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
            var endTimeString = `${body.date} ${body.slot[1]}:00`;
            var endTimeFormat = moment(endTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');

            //Get available team..
            var teamId = await getAvailableTeam(address, startTimeFormat, endTimeFormat);
            if(teamId.success && teamId.team_id){
                
                var data = await calculateRateAndTime(carts);
  
                if(data.items.length > 0){

                    var pItems = [];
                    var bookingTotal = data.price; 
                    var bTAfterDiscount = data.price;
                    var taxAmount = ((data.price * taxRate)/100).toFixed(20);
                    var tPAmount = parseFloat(data.price) + parseFloat(taxAmount);
                    var timeTotal = data.duration; 

                    var posted_booking = {
                        "user_id": body.user_id,
                        "team_id": teamId.team_id,
                        "address_id": address._id,
                        "items_total": bookingTotal,
                        "discount_amount": 0,
                        "total_after_discount": bTAfterDiscount,
                        "tip_amount": 0,
                        "tax": taxAmount,
                        "service_charge": 0,
                        "total_payable_amount": tPAmount,
                        "start_time" : new Date(startTimeFormat),
                        "end_time" : new Date(endTimeFormat),
                        "total_time_duration": timeTotal,
                        "payment_status" : "pending",
                        "items": data.items
                    };
        
                    //add new Booking
                    var Booking = helper.getModel("appointment");
                    var newBooking = new Booking(posted_booking);
                    newBooking.save(async function (err, dbres) {
                        if (err) {
                            res.json({
                                success: false,
                                message: "Something went wrong to save data in booking.",
                                mongoose_error: JSON.stringify(err),
                                data : null
                            });
                            res.end();
                            return;
                        } else {
                            if (dbres && dbres._id) {
                                res.json({
                                    success: true,
                                    message: 'Booking Success!',
                                    data: await getFormattedBooking(dbres._id),
                                });
                                res.end();
                                return;
                            } else {
                                res.json({
                                    success: false,
                                    message: "Something went wrong to save data in booking.",
                                    mongoose_error: JSON.stringify(err),
                                    data : null
                                });
                                res.end();
                                return;
                            }
                        }
                    })
                     
                }else{
                    res.json({
                        success: false,
                        message: "Something went wrong to save data in booking.",
                        data : null
                    });
                    res.end();
                    return;
                }
                
            }else{
                res.json({
                    success: false,
                    message: "Selected slot is already booked!",
                    data : null
                });
                res.end();
                return;
            }

        }else{
            res.json({
                success: false,
                message: "User address is invalid!",
                data : null
            });
            res.end();
            return;
        }
       

    } catch (err) {
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}
 

//Appointment list... 
module.exports.getAllbooking = async (req, res) => {
    try {
        const { user_id } = req.params;
        const { period } = req.query;
        
        var match1 = {$match: {
			user_id: mongoose.Types.ObjectId(user_id),
            status: {
                $ne:  'draft'
            } 
		}};

		if(period == 'all'){
			var match2 = {$match: {}};
		} else {
            if(period == 'last_month'){
				var start_date = moment().add(-1, 'month').startOf('month').format('YYYY-MM-DD');
				var end_date =  moment().add(-1, 'month').endOf('month').format('YYYY-MM-DD');	
			} else if(period == 'quarterly'){
				var start_date = moment().startOf('quarter').startOf('day').format('YYYY-MM-DD');
				var end_date = moment().endOf('quarter').endOf('day').format('YYYY-MM-DD');			
			} else if(period == 'yearly'){
				var start_date = moment().add(-1, 'year').format('YYYY-MM-DD');
				var end_date = moment().add(+1, 'days').format('YYYY-MM-DD');
			} else{
                var start_date = moment().add(-1, 'month').format('YYYY-MM-DD');
				var end_date = moment().add(+1, 'days').format('YYYY-MM-DD');
            }
			
			var match2 = {$match: {
				"created_at": {
					'$gte': new Date(start_date),
					'$lt': new Date(end_date)
				}
			}};
		}

        appointmentModel.aggregate([
			match1,
			{
				$lookup:
				{
					from: "users",
					localField: "user_id",
					foreignField: "_id",
					as: "user_info"
				}
			},
			{$unwind: {
				"path": "$user_info",
				"preserveNullAndEmptyArrays": true
			}},
			{
				$lookup:
				{
					from: "techteams",
					localField: "team_id",
					foreignField: "_id",
					as: "team_info"
				}
			},
			{$unwind: {
				"path": "$team_info",
				"preserveNullAndEmptyArrays": true
			}},
            {
				$lookup:
				{
					from: "feedbacks",
					localField: "_id",
					foreignField: "booking_id",
					as: "feedback_info"
				} 
			},
			{$unwind: {
				"path": "$feedback_info",
				"preserveNullAndEmptyArrays": true
			}},
			match2,
			{$sort: {
				_id: -1
			}},
		]).exec(function (err, results) {
            if (err) {
				res.json({
					success: false,
					message: "Something went wrong to fetch booking details.",
					mongoose_error: JSON.stringify(err),
					data: null
				});
				res.end();
				return;
            } else {
				res.json({
					success: true,
					message: "Success",
                    data: results,
				});
				res.end();
				return;
            }
        })
         
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: err })
    }
}

//Appointment Summary/Details...............................................
module.exports.bookingDetails = async (req, res) => {
    try {
        const { _id } = req.params;
        const data = await getFormattedBooking(_id)
        if (data) {
            res.send({ success: true, message: "Booking Details!", data: data })
        } else {
            res.send({ success: true, message: "Booking details not found", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: err })
    }
}

//Appointment Add/Remove Coupoun and tip...............................................
module.exports.updateAppointments = async (req, res) => {
    try {
        const { _id, action } = req.params;

        const data = await appointmentModel.findById(_id)
        if (data) {

            var updated = false;
            if(action == 'coupon'){

                if (!req.body.promocode) {
                    res.json({
                        success: false,
                        message: "Required parameters is missing (promocode)",
                        data : null
                    });
                    res.end();
                    return;
                }

                //Find promocode if available..
                var currentTime = moment().format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
                const promo_code = await PromoCode.findOne({
                    code: req.body.promocode.toUpperCase(),
                    status: true,
                    $and : [ 
                        {
                            "startDate": {
                                $lte: new Date(currentTime)
                            }
                        }, {
                            "endDate": {
                                $gte: new Date(currentTime)
                            }
                        }
                    ]
                });

                if(!promo_code){
                    return res.send({ success: false, message: "Invalid Promocode!", data: null })
                }
 
                var bookingTotal = data.items_total; 
                //calculate discount...
                var discount = (promo_code.discount ? promo_code.discount : 0);
                var discountType = (promo_code.couponType == 'Percentage' ? "percent" : "fixed");;
                if(discountType == 'percent'){
                    discount = ((bookingTotal*discount)/100).toFixed(2);
                }
                var bTAfterDiscount = bookingTotal - discount;
                var taxAmount = ((bTAfterDiscount * taxRate)/100).toFixed(20);
                var tPAmount = parseFloat(bTAfterDiscount) + parseFloat(taxAmount) + parseFloat(data.tip_amount);

                //update promocode..
                updated = await appointmentModel.updateOne(
                    { _id: mongoose.Types.ObjectId(_id) },
                    {
                        $set: {
                            "promo_code" : promo_code.code,
                            "discount_amount": discount,
                            "discount_type": discountType,
                            "total_after_discount": bTAfterDiscount,
                            "tax": taxAmount,
                            "total_payable_amount": tPAmount,
                            "updated_at": new Date(),
                        }
                    }
                )
 
            }else if(action == 'remove_coupon'){
                var bookingTotal = data.items_total; 
                var bTAfterDiscount = bookingTotal;
                var taxAmount = ((bookingTotal * taxRate)/100).toFixed(20);
                var tPAmount = parseFloat(bTAfterDiscount) + parseFloat(taxAmount)  + parseFloat(data.tip_amount);
                //update promocode..
                updated = await appointmentModel.updateOne(
                    { _id: mongoose.Types.ObjectId(_id) },
                    {
                        $set: {
                            "promo_code" : "",
                            "discount_amount": 0,
                            "discount_type": 'fixed',
                            "total_after_discount": bTAfterDiscount,
                            "tax": taxAmount,
                            "total_payable_amount": tPAmount,
                            "updated_at": new Date(),
                        }
                    }
                )

            }else if(action == 'tip'){

                if (!req.body.tip_amount) {
                    if(req.body.tip_amount >= 0){
                        if(req.body.tip_amount == ""){
                            req.body.tip_amount = 0;
                        }
                    }else{
                        res.json({
                            success: false,
                            message: "Required parameters is missing (tip_amount)",
                            data : null
                        });
                        res.end();
                        return;
                    }
                }
 
                var bTAfterDiscount = data.total_after_discount;
                var taxAmount = data.tax;
                var tip_amount = req.body.tip_amount
                var tPAmount = parseFloat(bTAfterDiscount) + parseFloat(taxAmount)  + parseFloat(tip_amount);
                //update promocode..
                updated = await appointmentModel.updateOne(
                    { _id: mongoose.Types.ObjectId(_id) },
                    {
                        $set: {
                            "tip_amount": tip_amount,
                            "total_payable_amount": tPAmount,
                            "updated_at": new Date(),
                        }
                    }
                )
            }else if(action == 'payment'){

                if (!req.body.payment_details || !req.body.payment_details.payment_mode) {
                    res.json({
                        success: false,
                        message: "Required parameters is missing (payment_details.payment_mode)",
                        data : null
                    });
                    res.end();
                    return;
                }

                if(req.body.payment_details.payment_mode != 'cash'){
                    res.json({
                        success: false,
                        message: "Invalid payment mode, Only `cash` is applicable!",
                        data : null
                    });
                    res.end();
                    return;
                }

                //update promocode..
                updated = await appointmentModel.updateOne(
                    { _id: mongoose.Types.ObjectId(_id) },
                    {
                        $set: {
                            "payment_status": 'complete',
                            "payment_mode": 'cash',
                            "status": 'pending',
                            "updated_at": new Date(),
                        }
                    }
                )

                //Remove user cart items..
                await cartModel.deleteMany({user_id : data.user_id});

            } 
            
            if(updated){

                return res.send({ success: true, message: "Booking Updated!", data: await getFormattedBooking(_id) })

            }else{
                res.json({
                    success: false,
                    message: "Invalid update action!",
                    data : null
                });
                res.end();
                return;
            }
 
        } else {
            res.json({
                success: false,
                message: "Booking details not found!",
                data : null
            });
            res.end();
            return;
        }
    } catch (err) {
        res.status(500);
        res.json({
            success: false,
            message: 'Internal Server Error',
            data: err,
        });
        res.end();
        return;
    }
}
 
//Appointments..Reschedule.............................................
module.exports.userAppointmentsReschedule = async (req, res) => {
    try {
        const { body } = req;
        const { _id } = req.params;
        
        const data = await appointmentModel.findById({_id: _id})
        if (data._id) {
            var date = (body.date) ? body.date : "";
            var timeSlots = (body.time_slot) ? body.time_slot : "";
           
            if(!date || !timeSlots){
                res.json({
                    error: true,
                    message: "Required parameters missing!"
                });
                res.end();
                return;
            }
 
            var startTimeString = date+" "+timeSlots.start_time_slot+":00";
            var startTimeFormat = moment(startTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
            var endTimeString = date+" "+timeSlots.end_time_slot+":00";
            var endTimeFormat = moment(endTimeString).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
 
            //Get available team..
            var teamId = await getAvailableTeam(data.delivery_location, startTimeFormat, endTimeFormat, _id);
            if(teamId.success && teamId.team_id){
                teamId = teamId.team_id;

                //update time slot and team..
                const appointmenUpdate = await appointmentModel.updateOne(
                    { _id: mongoose.Types.ObjectId(_id) },
                    {
                        $set: {
                            team_id: teamId,
                            start_time : new Date(startTimeFormat),
                            end_time : new Date(endTimeFormat),
                            updated_at: new Date(),
                        }
                    }
                )
                if(appointmenUpdate){
                    res.json({
                        error: false,
                        message: 'Booking rescheduled!',
                        data : { team_id : teamId }
                    });
                    res.end();
                    return;
                }else{
                    res.json({
                        error: true,
                        message: "Something went wrong. Please try again!",
                    });
                    res.end();
                    return;
                }
            }else{
                res.json({
                    error: true,
                    message: teamId.message
                });
                res.end();
                return;
            }
        } else {
            res.json({
                error: true,
                message: "No booking details found!",
                responseCode: 0
            });
            res.end();
            return;
        }

    } catch (err) {
        res.json({
            error: true,
            message: "Internal Server Error!",
            mongoose_error: JSON.stringify(err)
        });
        res.end();
        return;
    }
}

//addpackage
module.exports.addPackage = async (req, res) => {
    try {
        const { package_name, type, description, package_price, unit_price, services_count, subServicesId, features} = req.body;
        if (package_name && type &&  package_price && unit_price && services_count && subServicesId) {
            const pack = new package({
                package_name: package_name,
                description: description,
                type: type,
                subServicesId:subServicesId,
                services_count:services_count,
                unit_price:unit_price,
                package_price: package_price,
                features:features,
            });
            await pack.save();
            res.status(201).send({ success: true, message: "Pacakage Added Successfully!", data: pack })
        } else {
            res.status(400).send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.status(400).send({ success: false, message: "Internal Server Error", data: null })
    }
}

//updatePackage
module.exports.updatedPackage = async (req, res) => {
    try {
        const { _id } = req.params;
        const { package_name, description, package_price, unit_price, services_count, features } = req.body;
        if (package_name && package_price && unit_price && services_count)  {
            const pacakageUpdate = await package.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        package_name: package_name,
                        description: description,
                        services_count:services_count,
                        unit_price:unit_price,
                        package_price: package_price,
                        features:features,
                    }
                }
            )
            if (pacakageUpdate.modifiedCount === 1) {
                res.send({ success: true, message: "Pacakage Updated Successfully!", data: null })
            } else {
                res.send({ success: false, message: "Pacakage Does't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "All Fields Are Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllPackage
module.exports.getAllPackage = async (req, res) => {
    try {
        const data = await package.find()
        if (data.length > 0) {
            res.send({ success: true, message: "Get All Package Successfully", data: data })
        } else {
            res.send({ success: true, message: "Not Found Package", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//getAllPackage
module.exports.getPackageById = async (req, res) => {
    try {
        const { _id } = req.params;
        const data = await package.find({_id:_id})
        if (data.length > 0) {
            res.send({ success: true, message: "Get Package Details Successfully", data: data })
        } else {
            res.send({ success: true, message: "Not Found Package", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//deletepackage
module.exports.deletePackage = async (req, res) => {
    try {
        const { _id } = req.params;
        const deleteData = await package.findByIdAndDelete({_id:_id})
        if (deleteData) {
            res.send({ success: true, message: "Package Deleted Successfully", data: deleteData })
        } else {
            res.send({ success: false, message: "Package Does't Deleted", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}


//updateBookingstatus
module.exports. updatedBookingStatus = async (req, res) => {
    try {
        const { _id } = req.params;
        const { status } = req.body;
        if (status) {
            const statusUpdate = await appointmentModel.updateOne(
                { _id: mongoose.Types.ObjectId(_id) },
                {
                    $set: {
                        status: status,
                        status_date: new Date()
                    }
                }
            )
            if (statusUpdate.modifiedCount === 1) {
                res.send({ success: true, message: "Booking Status Updated Successfully", data: null })
            } else {
                res.send({ success: false, message: "Booking Status Does't Updated", data: null })
            }
        } else {
            res.send({ success: false, message: "Status is Required", data: null })
        }
    } catch (err) {
        res.send({ success: false, message: "Internal Server Error", data: null })
    }
}

//bookingList 
module.exports.fileUploads = async (req, res) => {
    try {
        
        var uploads = [];
        if(req.files){
            var fileKeys = Object.keys(req.files);
            await Promise.all(fileKeys.map(async (fieldName, index) => {
                if(req.files[fieldName] && req.files[fieldName].length > 0){
                    await Promise.all(req.files[fieldName].map(async (element, index1) => {
                        const path  = await uploadImage.uploadImage(element);
                        uploads.push({url: path, type: path.split('.').pop()});
                    }));
                }

            }));
        }
        
        //send..
        if(uploads.length > 0){
            res.json({
                success: true,
                message: 'Files Uploaded Successfully!',
                data: uploads,
            });
            res.end();
            return;
        }else{
            res.json({
                success: false,
                message: 'No files uploaded!',
                data: [],
            });
            res.end();
            return;
        }

    } catch (err) {
        res.status(500);
        res.json({
            success: false,
            message: "Internal Server Error!",
            mongoose_error: JSON.stringify(err),
        });
        res.end();
        return;
    }
}