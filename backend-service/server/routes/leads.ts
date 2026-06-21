import express from 'express';
import prisma from '../prisma';

const router = express.Router();

// Create or Update Lead
router.post('/', async (req, res) => {
    try {
        const { email, name, phone, companyName, taxId, plan, step, details } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        // Check if lead exists
        const existingLead = await prisma.lead.findUnique({
            where: { email }
        });

        let lead;
        if (existingLead) {
            // Update
            lead = await prisma.lead.update({
                where: { email },
                data: {
                    name: name || existingLead.name,
                    phone: phone || existingLead.phone,
                    companyName: companyName || existingLead.companyName,
                    taxId: taxId || existingLead.taxId,
                    plan: plan || existingLead.plan,
                    step: step || existingLead.step,
                    details: details ? JSON.stringify(details) : existingLead.details,
                    updatedAt: new Date()
                }
            });
        } else {
            // Create
            lead = await prisma.lead.create({
                data: {
                    email,
                    name: name || 'Unknown',
                    phone,
                    companyName,
                    taxId,
                    plan,
                    step: step || 1,
                    status: 'NEW',
                    details: details ? JSON.stringify(details) : null
                }
            });
        }

        res.json({ success: true, lead });
    } catch (error: any) {
        console.error('Lead save error:', error);
        res.status(500).json({ success: false, message: 'Failed to save lead', error: error.message });
    }
});

export default router;
