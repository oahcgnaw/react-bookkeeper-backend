import express from "express";
import {Prisma, PrismaClient} from "@prisma/client";
import jwt from "jsonwebtoken";
import {getUserByJWT} from "./Tags.js";

const prisma = new PrismaClient();

interface WhereClause extends Prisma.accountsWhereInput {
  user_id?: number;
  happened_at?: Prisma.DateTimeFilter;
}

// This method is used to fix the problem that
// Express would replace the '+' with a space from the query params
function isoStandardize(date: string) {
  return new Date(new Date(date.replace(' ', '+')));
}

const router = express.Router();

router.post('/', async (req, res) => {
  const {amount, kind, happened_at, tag_id} = req.body;
  try {
    // get user using jwt
    const user = await getUserByJWT(req);
    if (!user) {
      return res.status(401).json({error: 'User not found.(Message from server)'});
    }
    const account = await prisma.accounts.create(
      {
        data: {
          user_id: user?.id,
          amount,
          kind,
          happened_at,
          tag_id
        }
      }
    )
    const tag = await prisma.tags_collection.findUnique({
      where: {
        id: tag_id
      }
    })
    const responseBody = {
      "resource": {
        ...account,
        "tag": tag
      }
    }
    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(401).json({error: 'An error occurred while fetching tags.(Message from server)'});
  } finally {
    prisma.$disconnect()
  }
})

// handling requesting for all items of a user, with pagination
router.get('/', async (req, res) => {
  const {page, happened_after, happened_before} = req.query;
  // Convert page to number and handle default case
  const pageNumber = Number(page) || 1;
  const itemsPerPage = 10; // or any number you prefer
  // Calculate the offset for pagination
  const offset = (pageNumber - 1) * itemsPerPage;

  let whereClause: WhereClause = {};

  try {
    // get user info
    const user = await getUserByJWT(req);
    if (!user) {
      return res.status(401).json({error: 'User not found.(Message from server)'});
    }
    whereClause['user_id'] = user.id
    // if happened_after and happened_before are provided, add them to where clause
    if (happened_after && happened_before) {
      const utc_start = isoStandardize(happened_after as string)
      const utc_end = isoStandardize(happened_before as string)
      whereClause['happened_at'] = {
        gte: utc_start,
        lte: utc_end
      }
    }
    const accountsCount = await prisma.accounts.count({where: whereClause})
    const accounts = await prisma.accounts.findMany({
      where: whereClause,
      skip: offset,
      take: itemsPerPage,
      include: {
        tag: true
      }
    });
    // push accounts stream
    const responseBody = {
      resources: accounts.map(account => ({
        ...account,
        tag: account.tag
      }))
      ,
      pager: {
        page: pageNumber,
        per_page: itemsPerPage,
        count: accountsCount
      }
    }
    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({error: 'An error occurred while fetching accounts.(Message from server)'});
  } finally {
    await prisma.$disconnect();
  }
})

// handling requesting for balance of a period of time: GET /api/v1/items/balance
router.get('/balance', async (req, res) => {
  const {happened_after, happened_before} = req.query;
  let whereClause: WhereClause = {};
  try {
    // get user info
    const user = await getUserByJWT(req);
    if (!user) {
      return res.status(401).json({error: 'User not found.(Message from server)'});
    }
    if (!happened_after || !happened_before) {
      return null;
    }
    const utc_start = isoStandardize(happened_after as string)
    const utc_end = isoStandardize(happened_before as string)
    // calculate income in a period
    const income = await prisma.accounts.aggregate({
      where: {
        user_id: user.id,
        kind: 'income',
        happened_at: {
          gte: utc_start,
          lte: utc_end
        }
      },
      _sum: {
        amount: true
      }
    })
    // calculate expenses in a period
    const expense = await prisma.accounts.aggregate({
      where: {
        user_id: user.id,
        kind: 'expenses',
        happened_at: {
          gte: utc_start,
          lte: utc_end
        }
      },
      _sum: {
        amount: true
      }
    })
    const balance = (income?._sum.amount || 0) - (expense._sum.amount || 0)
    const responseBody = {
      income: income._sum.amount || 0,
      expenses: expense._sum.amount || 0,
      balance: balance
    }
    res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({error: 'An error occurred while fetching accounts.(Message from server)'});
  } finally {
    await prisma.$disconnect();
  }
});

// handling the delete request
router.delete('/:id', async (req, res) => {
  const {id} = req.params;
  try {
    const account = await prisma.accounts.delete({
      where: {
        id: Number(id)
      },
      include: {
        tag: true
      }
    })
    const responseBody = {
      "resource": {
        ...account,
        "tag": account.tag
      }
    }
    return res.status(200).json(responseBody);
  } catch (error) {
    return res.status(500).json({error: 'An error occurred while deleting account.(Message from server)'});
  } finally {
    await prisma.$disconnect();
  }
})

export default router;
