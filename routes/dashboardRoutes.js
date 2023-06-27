
module.exports = function (app) {
    const dashboardController = require('../controllers/dashboardApi');



    app.post('/addManualUser', dashboardController.addManualUser);

    //LeadSource...........................
    app.post('/addLeadSource', dashboardController.addLead);
    app.post('/updateLeadSource', dashboardController.updateLead);
    app.get('/GetAllLeadSource', dashboardController.getAllLead);
    app.post('/DeleteLeadSource', dashboardController.deleteLead);

    //PromoCode.....................................
    app.post('/addPromoCode', dashboardController.addCouponsPromoCode);
    app.post('/updatePromoCode', dashboardController.updateCouponsPromoCode);
    app.get('/GetAllPromoCode', dashboardController.getAllPromoCodeCoupon);
    app.post('/DeletePromoCode', dashboardController.deletePromoCodeCoupon);

    //techTeam...................................................
    app.post('/addTechTeam', dashboardController.addTechTeam);
    app.post('/updateTechTeam', dashboardController.updateTechTeam);
    app.get('/GetAllTechTeam', dashboardController.getAllTechTeam);
    app.post('/DeleteTechTeam', dashboardController.deleteTechTeam);

    //AddManualBooking..................................
    app.post('/addManualBooking', dashboardController.manualBooking);
    app.post('/updateManualBooking', dashboardController.updatedManualBooking);
    app.get('/GetAllManualBooking', dashboardController.getAllManualBooking);
    app.post('/deleteManualBooking', dashboardController.deleteManualBooking);


};