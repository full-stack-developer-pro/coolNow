
module.exports = function (app) {
    const dashboardController = require('../controllers/dashboardApi');



    app.post('/addManualUser', dashboardController.addManualUser);
    app.post('/updateManualUser', dashboardController.updateUser);
    app.get('/GetAllUser', dashboardController.getAllUser);
    app.get('/GetUserDetails', dashboardController.getUserById);
    app.post('/DeleteUser', dashboardController.deleteUser);

    //addTechnician
    app.post('/addTechnician', dashboardController.addTechnician);
    app.post('/updateTechnician', dashboardController.updateTechnician);
    app.get('/GetAllTechnician', dashboardController.getAllTechnician);
    app.get('/GetTechnicianDetails', dashboardController.getTechnicianById);
    app.post('/DeleteTechnician', dashboardController.deleteTechnician);


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



    //Services..................................
    app.post('/addServices', dashboardController.addServices);
    app.post('/updateServices', dashboardController.updatedServices);
    app.get('/GetAllServices', dashboardController.getAllServices);
    app.post('/deleteServices', dashboardController.deleteServices);


    //Banner..................................
    app.post('/addBanner', dashboardController.addBanner);
    app.post('/updatebanner', dashboardController.updatedBanner);
    app.get('/GetAllBanner', dashboardController.getAllBanner);
    app.post('/deleteBanner', dashboardController.deleteBanner);


    //supplier................................
    app.post('/addSupplier', dashboardController.addSupplier);
    app.post('/updateSupplier', dashboardController.updatedSupplier);
    app.get('/getAllSupplier', dashboardController.getAllSupplier);
    app.post('/deleteSupplier', dashboardController.deleteSupplier);




};